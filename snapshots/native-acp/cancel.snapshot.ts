/** Native ACP cancellation and a rejected permission request, driven over JSON-RPC. */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { JsonRpcLineTransport } from '@redspark/rsh-json-rpc-line'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Poll until `ready` holds, so a notification that has not arrived yet is not mistaken for silence. */
async function waitFor(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('native-acp cancel: timed out waiting for the recorded state')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

it('cancels a streaming turn and refuses the write behind a rejected permission', async () => {
  let streaming = false
  let permissionTurn = false
  const requests: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body) as Record<string, unknown>
      requests.push(payload)
      const messages = payload.messages as readonly { role: string }[]
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (permissionTurn && messages.at(-1)?.role !== 'tool') {
        const call = {
          index: 0,
          id: 'refused-write-call',
          type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path: 'refused.txt', content: 'denied\n' }) },
        }
        const events = [
          { choices: [{ delta: { role: 'assistant', tool_calls: [call] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]
        response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      // A streaming turn holds the response open: only the cancel ends this request.
      if (streaming) return
      const events = [
        { choices: [{ delta: { role: 'assistant', content: 'unused' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]
      response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-acp cancel: missing model endpoint')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-acp-cancel-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'You are a native ACP fixture.', maxSteps: 2 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
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
  const permissionRequests: Record<string, unknown>[] = []
  transport.onNotification((method, params) => {
    if (method === 'session/update') output.push(params.update as Record<string, unknown>)
  })
  transport.onRequest((method, params) => {
    expect(method).toBe('session/request_permission')
    permissionRequests.push(params)
    return { outcome: { outcome: 'selected', optionId: 'reject-once' } }
  })
  transport.start()
  const signal = AbortSignal.timeout(20_000)
  try {
    await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal)
    const created = await transport.request('session/new', { cwd: workspace, mcpServers: [] }, signal) as { sessionId: string }

    streaming = true
    const cancelled = transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'Start a long task; this turn will be cancelled mid-stream.' }] }, signal)
    await waitFor(() => requests.length > 0)
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await expect(cancelled).resolves.toMatchObject({ stopReason: 'cancelled' })

    streaming = false
    permissionTurn = true
    const before = output.length
    const refused = await transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'Write refused.txt, even if the client rejects the permission.' }] }, signal)
    expect(refused).toMatchObject({ stopReason: 'end_turn' })
    expect(permissionRequests).toHaveLength(1)
    expect(existsSync(join(workspace, 'refused.txt'))).toBe(false)
    const calls = output.slice(before).filter(update => update.toolCallId === 'refused-write-call')
    expect(calls).toMatchObject([{ sessionUpdate: 'tool_call' }, { sessionUpdate: 'tool_call_update', status: 'failed' }])

    await transport.request('session/close', { sessionId: created.sessionId }, signal)
    expect(requests.length).toBeGreaterThanOrEqual(2)
  } finally {
    child.kill('SIGKILL')
    server.close()
  }
})
