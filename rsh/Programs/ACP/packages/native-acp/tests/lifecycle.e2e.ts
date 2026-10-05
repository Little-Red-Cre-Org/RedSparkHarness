/** ACP cancellation and EOF drain through the built public launcher. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { execa } from 'execa'
import { expect, it, vi } from 'vitest'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-json-rpc-line'
import { startHttpMcpFixture } from '../../../../../Modules/Official/mcp/mcp-client/tests/http-fixture.ts'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent'
import { plugin as executionPlugin } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as modelSelectionPlugin } from '@deepseek-ai/dsh-native-model-selection/native'
import { MockAdapter, textResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin as carrierPlugin, NativeAcpApplication } from '../src/native.ts'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))

async function failedClose(home: string): Promise<void> {
  const scope = new NativeScope()
  const input = new PassThrough()
  const output = new PassThrough()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const failure = new Error('ACP retained writer close failed')
  const causes = (error: unknown): readonly unknown[] => error instanceof AggregateError ? error.errors.flatMap(causes) : [error]
  const model = new MockAdapter([textResponse('Retained ACP turn.')])
  let app: NativeAcpApplication | undefined
  const modelProvider: NativePlugin = { apiVersion: 1, name: 'close-model', targets: ['host'],
    requires: [], provides: ['model', 'modelDirectory'], resolve: () => (context) => {
      context.provide('model', model)
      context.provide('modelDirectory', { providers: () => [{ id: 'mock', name: 'Mock' }],
        catalog: async defaults => ({ default: defaults, routableProviders: ['mock'], failures: [],
          groups: [{ id: 'mock', name: 'Mock', models: [{ id: 'mock', name: 'Mock' }] }] }),
        resolve: (provider, id) => model.resolveModel(provider, id) })
    } }
  const capture: NativePlugin = { apiVersion: 1, name: 'close-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'activeSessions'], provides: [], resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeAcpApplication)) throw new Error('ACP close carrier missing')
      app = application
      context.effect(context.require('activeSessions').onAttached(async (owner) => { context.own(owner.retain()) }))
      const storage = context.require('sessionPersistence')
      const open = storage.open.bind(storage)
      const spy = vi.spyOn(storage, 'open').mockImplementation(async (...args) => {
        const writer = await open(...args)
        if (args[1] === 'write') {
          const close = writer.close.bind(writer)
          vi.spyOn(writer, 'close').mockImplementation(async () => {
            entered.resolve(undefined)
            await release.promise
            await close()
            throw failure
          })
        }
        return writer
      })
      context.own(() => { spy.mockRestore() })
    } }
  const carrier: NativePlugin = { ...carrierPlugin, resolve: () => (context) => {
    context.provide('application', new NativeAcpApplication(context, { provider: 'mock', model: 'mock',
      systemPrompt: 'ACP retained close.', maxSteps: 1, maxPendingPermissions: 32, mcpToolCallTimeoutMs: 60_000 }, input, output))
  } }
  const host = new NativeHost(resolveInstallation([
    { plugin: carrier, scope, config: undefined }, { plugin: modelProvider, scope, config: undefined },
    { plugin: capture, scope, config: undefined }, { plugin: executionPlugin, scope, config: undefined },
    { plugin: modelSelectionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined }, { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: home } },
    { plugin: persistencePlugin, scope, config: { root: join(home, 'failed-close-sessions'), compression: 'none' } },
  ], 'host'))
  await host.start()
  if (app === undefined) throw new Error('ACP close carrier did not start')
  const application = app
  const done = host.run(scope, { kind: 'test' }, invocation => application.run([], invocation.signal)).catch((error: unknown) => error)
  const transport = new JsonRpcLineTransport(output, input)
  transport.start()
  const signal = AbortSignal.timeout(10_000)
  try {
    await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal)
    const created = await transport.request('session/new', { cwd: home, mcpServers: [] }, signal) as { sessionId: string }
    const closing = transport.request('session/close', { sessionId: created.sessionId }, signal).catch((error: unknown) => error)
    await entered.promise
    const rejected = async (): Promise<void> => {
      await expect(transport.request('session/resume', { sessionId: created.sessionId, cwd: home, mcpServers: [] }, signal))
        .rejects.toThrow('session is already active')
      await expect(transport.request('session/prompt', { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'late input' }] }, signal))
        .rejects.toThrow('session is closing')
      await expect(transport.request('session/set_config_option', { sessionId: created.sessionId, configId: 'model', value: 'late' }, signal))
        .rejects.toThrow('session is closing')
    }
    await rejected()
    release.resolve(undefined)
    expect(await closing).toBeInstanceOf(Error)
    await rejected()
    expect(model.requests).toHaveLength(0)
    input.end()
    expect(causes(await done)).toContain(failure)
  } finally {
    release.resolve(undefined)
    input.end()
    await done
    try { await host.stop() } catch (error) { expect(causes(error)).toContain(failure) }
    transport.close()
    input.destroy()
    output.destroy()
  }
}

it('admits ordered ACP images, rejects malformed data, restores history and drains cancellation and EOF', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-acp-lifecycle-'))
  const entered = Promise.withResolvers<undefined>()
  let toolTurn = false
  let mcpCall: { name: string; arguments: string } | undefined
  let permissionEntered = Promise.withResolvers<undefined>()
  let permissionRelease = Promise.withResolvers<undefined>()
  let permissionSettled = Promise.withResolvers<undefined>()
  let holdPermission = false
  const permissionRequests: Record<string, unknown>[] = []
  let lastUpdate: unknown
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body) as { messages: readonly { role: string }[] }
      requests.push(payload)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (toolTurn) {
        const events = payload.messages.at(-1)?.role === 'tool'
          ? [{ choices: [{ delta: { role: 'assistant', content: 'permission tool settled' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] }]
          : [{ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'permission-call', type: 'function',
            function: mcpCall ?? { name: 'write_file', arguments: JSON.stringify({ path: 'permission.txt', content: 'forbidden' }) } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":"partial"}}]}\n\n')
      entered.resolve(undefined)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model endpoint did not bind')
  const patch = join(home, 'model.patch.json')
  await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'ACP lifecycle fixture', maxSteps: 2 } },
    { id: 'storage', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_ACP_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text', 'image'] }] } } } },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-acp', '--patch', patch], {
    cwd: home, env: { DSH_HOME: home, NATIVE_ACP_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  transport.onNotification((method, params) => { if (method === 'session/update') lastUpdate = params.update })
  transport.onRequest(async (method, params) => {
    expect(method).toBe('session/request_permission')
    expect(lastUpdate).toMatchObject({ sessionUpdate: 'tool_call', toolCallId: 'permission-call' })
    expect(params.options).toMatchObject([{ optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'reject-once', kind: 'reject_once' }])
    permissionRequests.push(params)
    if (!holdPermission) return { outcome: { outcome: 'selected', optionId: 'unknown-grant' } }
    permissionEntered.resolve(undefined)
    try {
      await permissionRelease.promise
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    } finally { permissionSettled.resolve(undefined) }
  })
  transport.start()
  const signal = AbortSignal.timeout(20_000)
  const http = await startHttpMcpFixture()
  try {
    expect(await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal))
      .toMatchObject({ agentCapabilities: { promptCapabilities: { image: true, audio: false, embeddedContext: false } } })
    const created = await transport.request('session/new', { cwd: home, mcpServers: [] }, signal) as { sessionId: string }
    await expect(transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'image', mimeType: 'image/png', data: 'not-base64' }] }, signal)).rejects.toThrow()
    expect(requests).toHaveLength(0)
    const image = (await readFile(join(root, 'snapshots/native-sdk/text-turn/image.png'))).toString('base64')
    const params = { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'wait until cancelled' },
      { type: 'image', mimeType: 'image/png', data: image }] }
    const prompt = transport.request('session/prompt', params, signal)
    void prompt.catch(() => {}) // The later assertion owns failures; teardown must not create an unhandled rejection.
    await entered.promise
    const sent = requests[0] as { messages: readonly { role: string; content: readonly Record<string, unknown>[] }[] }
    const user = sent.messages.find(message => message.role === 'user')
    expect(user?.content[0]).toEqual({ type: 'text', text: 'wait until cancelled' })
    const imagePart = user?.content.find(part => part.type === 'image_url')
    expect(imagePart?.image_url).toHaveProperty('url', expect.stringMatching(/^data:image\/png;base64,/))
    await expect(transport.request('session/prompt', params, signal)).rejects.toThrow('session prompt is already running')
    const configured = transport.request('session/set_config_option', { sessionId: created.sessionId,
      configId: 'model', value: JSON.stringify(['fixture', 'fixture-model']) }, signal)
    void configured.catch(() => {}) // Its assertion owns the protocol result after prompt drain.
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await transport.flush()
    expect(await prompt).toMatchObject({ stopReason: 'cancelled' })
    expect(await configured).toMatchObject({ configOptions: [{ id: 'model', currentValue: JSON.stringify(['fixture', 'fixture-model']) }] })
    toolTurn = true
    const permissionParams = { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'ask before writing permission.txt' }] }
    expect(await transport.request('session/prompt', permissionParams, signal)).toMatchObject({ stopReason: 'end_turn' })
    await expect(readFile(join(home, 'permission.txt'))).rejects.toHaveProperty('code', 'ENOENT')
    holdPermission = true
    const cancelledPermission = transport.request('session/prompt', permissionParams, signal)
    void cancelledPermission.catch(() => {}) // Its assertion owns the cancelled prompt response.
    await permissionEntered.promise
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await transport.flush()
    expect(await cancelledPermission).toMatchObject({ stopReason: 'cancelled' })
    await transport.request('session/close', { sessionId: created.sessionId }, signal)
    await transport.request('session/resume', { sessionId: created.sessionId, cwd: home, mcpServers: [] }, signal)
    expect(await transport.request('session/prompt', permissionParams, signal)).toMatchObject({ stopReason: 'end_turn' })
    expect(permissionRequests).toHaveLength(2)
    permissionRelease.resolve(undefined)
    await permissionSettled.promise
    await expect(readFile(join(home, 'permission.txt'))).rejects.toHaveProperty('code', 'ENOENT')
    const stdioServers = [{ name: 'fixture', command: process.execPath,
      args: [join(root, 'rsh/Modules/Official/mcp/mcp-client/tests/fixture-server.ts')], env: [] }]
    await expect(transport.request('session/new', { cwd: home, mcpServers: [{ ...stdioServers[0],
      command: join(home, 'missing-mcp-server') }] }, signal)).rejects.toThrow()
    expect(await transport.request('session/list', {}, signal)).toMatchObject({ sessions: [{ sessionId: created.sessionId }] })
    const stdioSession = await transport.request('session/new', { cwd: home, mcpServers: stdioServers }, signal) as { sessionId: string }
    const httpSession = await transport.request('session/new', { cwd: home, mcpServers: [{ type: 'http', name: 'fixture',
      url: http.url, headers: [{ name: 'Authorization', value: 'Bearer native-acp-test' }] }] }, signal) as { sessionId: string }
    const mcpPrompt = async (sessionId: string, expected: string, absent: string): Promise<void> => {
      const before = requests.length
      expect(await transport.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'use selected MCP tool' }] }, signal))
        .toMatchObject({ stopReason: 'end_turn' })
      const request = requests[before] as { tools: readonly { function: { name: string } }[] }
      const names = request.tools.map(tool => tool.function.name)
      expect(names).toContain(expected)
      expect(names).not.toContain(absent)
      const next = requests[before + 1] as { messages: readonly { role: string; content: string }[] }
      expect(next.messages.filter(message => message.role === 'tool').at(-1)?.content).toContain(expected.endsWith('add') ? '5' : 'pong')
    }
    mcpCall = { name: 'mcp__fixture__add', arguments: JSON.stringify({ a: 2, b: 3 }) }
    await mcpPrompt(stdioSession.sessionId, 'mcp__fixture__add', 'mcp__fixture__ping')
    await transport.request('session/close', { sessionId: stdioSession.sessionId }, signal)
    mcpCall = { name: 'mcp__fixture__ping', arguments: '{}' }
    await mcpPrompt(httpSession.sessionId, 'mcp__fixture__ping', 'mcp__fixture__add')
    expect(http.authorization).toContain('Bearer native-acp-test')
    await transport.request('session/resume', { sessionId: stdioSession.sessionId, cwd: home, mcpServers: stdioServers }, signal)
    mcpCall = { name: 'mcp__fixture__add', arguments: JSON.stringify({ a: 2, b: 3 }) }
    await mcpPrompt(stdioSession.sessionId, 'mcp__fixture__add', 'mcp__fixture__ping')
    await transport.request('session/close', { sessionId: stdioSession.sessionId }, signal)
    await transport.request('session/close', { sessionId: httpSession.sessionId }, signal)
    mcpCall = undefined
    permissionEntered = Promise.withResolvers<undefined>()
    permissionRelease = Promise.withResolvers<undefined>()
    permissionSettled = Promise.withResolvers<undefined>()
    const fresh = await transport.request('session/new', { cwd: home, mcpServers: [] }, signal) as { sessionId: string }
    const pending = transport.request('session/prompt', { ...permissionParams, sessionId: fresh.sessionId }, signal).catch((error: unknown) => error)
    await permissionEntered.promise
    const closingSelection = transport.request('session/set_config_option', { sessionId: fresh.sessionId,
      configId: 'model', value: JSON.stringify(['fixture', 'fixture-model']) }, signal).catch((error: unknown) => error)
    child.stdin.end()
    const exit = await child
    expect(exit.exitCode, exit.stderr).toBe(0)
    await pending
    expect(await closingSelection).toBeInstanceOf(Error)
    const paths = await readdir(join(home, 'sessions'), { recursive: true })
    const logs = await Promise.all(paths.filter(path => path.endsWith('session.v3.jsonl')).map(path => readFile(join(home, 'sessions', path), 'utf8')))
    expect(logs).toHaveLength(4)
    const previous = logs.find(log => (JSON.parse(log.split('\n')[0]!) as { id: string }).id === created.sessionId)
    if (previous === undefined) throw new Error('durable ACP Session missing')
    const current = logs.find(log => (JSON.parse(log.split('\n')[0]!) as { id: string }).id === fresh.sessionId)
    if (current === undefined) throw new Error('durable fresh ACP Session missing')
    const events = [previous, current].flatMap(log => log.trim().split('\n').slice(1)
      .map(line => JSON.parse(line) as { type: string; data: { reason?: { kind: string } } }))
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(5)
    expect(events.filter(event => event.type === 'native-approval/decided').map(event => event.data))
      .toMatchObject([{ outcome: 'rejected' }, { outcome: 'cancelled' }, { outcome: 'unavailable' }, { outcome: 'cancelled' }])
    expect(events.filter(event => event.type === 'model/selection')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('turn/end')
    await failedClose(home)
  } finally {
    permissionRelease.resolve(undefined)
    transport.close()
    child.kill('SIGKILL')
    await child
    await http.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    await rm(home, { recursive: true, force: true })
  }
})
