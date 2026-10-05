/** ACP cancellation and EOF drain through the built public launcher. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-json-rpc-line'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))

it('admits ordered ACP images, rejects malformed data, restores history and drains cancellation and EOF', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-acp-lifecycle-'))
  let entered = Promise.withResolvers<undefined>()
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body) as unknown)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":"partial"}}]}\n\n')
      entered.resolve(undefined)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model endpoint did not bind')
  const patch = join(home, 'model.patch.json')
  await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'ACP lifecycle fixture', maxSteps: 1 } },
    { id: 'storage', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_ACP_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text', 'image'] }] } } } },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-acp', '--patch', patch], {
    cwd: home, env: { DSH_HOME: home, NATIVE_ACP_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  transport.start()
  const signal = AbortSignal.timeout(20_000)
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
    expect(JSON.stringify(requests[0])).toContain('wait until cancelled')
    expect(JSON.stringify(requests[0])).toContain('data:image/png;base64,')
    await expect(transport.request('session/prompt', params, signal)).rejects.toThrow('session prompt is already running')
    const configured = transport.request('session/set_config_option', { sessionId: created.sessionId,
      configId: 'model', value: JSON.stringify(['fixture', 'fixture-model']) }, signal)
    void configured.catch(() => {}) // Its assertion owns the protocol result after prompt drain.
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await transport.flush()
    expect(await prompt).toMatchObject({ stopReason: 'cancelled' })
    expect(await configured).toMatchObject({ configOptions: [{ id: 'model', currentValue: JSON.stringify(['fixture', 'fixture-model']) }] })
    await transport.request('session/close', { sessionId: created.sessionId }, signal)
    await transport.request('session/resume', { sessionId: created.sessionId, cwd: home, mcpServers: [] }, signal)
    entered = Promise.withResolvers<undefined>()
    const pending = transport.request('session/prompt', params, signal).catch((error: unknown) => error)
    await entered.promise
    const closingSelection = transport.request('session/set_config_option', { sessionId: created.sessionId,
      configId: 'model', value: JSON.stringify(['fixture', 'fixture-model']) }, signal).catch((error: unknown) => error)
    child.stdin.end()
    const exit = await child
    expect(exit.exitCode, exit.stderr).toBe(0)
    await pending
    expect(await closingSelection).toBeInstanceOf(Error)
    const paths = await readdir(join(home, 'sessions'), { recursive: true })
    const physical = paths.find(path => path.endsWith('session.v3.jsonl'))
    if (physical === undefined) throw new Error('durable ACP Session missing')
    const events = (await readFile(join(home, 'sessions', physical), 'utf8')).trim().split('\n').slice(1)
      .map(line => JSON.parse(line) as { type: string; data: { reason?: { kind: string } } })
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
    expect(events.filter(event => event.type === 'model/selection')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('turn/end')
  } finally {
    transport.close()
    child.kill('SIGKILL')
    await child
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    await rm(home, { recursive: true, force: true })
  }
})
