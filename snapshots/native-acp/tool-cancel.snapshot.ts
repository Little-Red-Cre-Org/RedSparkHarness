/** Native ACP cancellation while a tool call is in flight, driven over JSON-RPC. */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { JsonRpcLineTransport } from '@redspark/rsh-json-rpc-line'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('cancels an in-flight tool call and skips the call behind it', async () => {
  let toolTurn = false
  const requests: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const calls = [
        { index: 0, id: 'wait-call', type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path: 'started.txt', content: 'started\n' }) } },
        { index: 1, id: 'skipped-call', type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path: 'skipped.txt', content: 'skipped\n' }) } },
      ]
      const events = toolTurn
        ? [{ choices: [{ delta: { role: 'assistant', tool_calls: calls } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        : [{ choices: [{ delta: { role: 'assistant', content: 'unused' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }]
      response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-acp tool-cancel: missing model endpoint')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-acp-tool-cancel-'))
  const workspace = join(home, 'workspace')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'You are a native ACP fixture.', maxSteps: 2 } },
    { id: 'storage', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      models: [{ id: 'fixture-model', input: ['text'] }] } } } },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'acp', '--patch', patch], {
    cwd: workspace, env: { ...process.env, RSH_HOME: home, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', RSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  const output: Record<string, unknown>[] = []
  const permissionSeen = Promise.withResolvers<undefined>()
  let releasePermission: (() => void) | undefined
  transport.onNotification((method, params) => {
    if (method === 'session/update') output.push(params.update as Record<string, unknown>)
  })
  transport.onRequest((method) => {
    expect(method).toBe('session/request_permission')
    permissionSeen.resolve(undefined)
    return new Promise(resolve => {
      releasePermission = () => { resolve({ outcome: { outcome: 'cancelled' } }) }
    })
  })
  transport.start()
  const signal = AbortSignal.timeout(20_000)
  try {
    await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal)
    const created = await transport.request('session/new', { cwd: workspace, mcpServers: [] }, signal) as { sessionId: string }

    toolTurn = true
    const prompted = transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'Write started.txt, then skipped.txt.' }] }, signal)
    await permissionSeen.promise
    expect(output).toContainEqual(expect.objectContaining({ sessionUpdate: 'tool_call', toolCallId: 'wait-call' }))
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await expect(prompted).resolves.toMatchObject({ stopReason: 'cancelled' })
    releasePermission?.()

    expect(output.filter(update => update.toolCallId === 'wait-call')).toMatchObject([
      { sessionUpdate: 'tool_call' },
      { sessionUpdate: 'tool_call_update', status: 'failed' },
    ])
    expect(output.filter(update => update.toolCallId === 'skipped-call')).toMatchObject([
      { sessionUpdate: 'tool_call' },
      { sessionUpdate: 'tool_call_update', status: 'failed' },
    ])
    expect(existsSync(join(workspace, 'started.txt'))).toBe(false)
    expect(existsSync(join(workspace, 'skipped.txt'))).toBe(false)

    await transport.request('session/close', { sessionId: created.sessionId }, signal)
    expect(requests.length).toBeGreaterThanOrEqual(1)
  } finally {
    releasePermission?.()
    child.kill('SIGKILL')
    server.close()
  }
})
