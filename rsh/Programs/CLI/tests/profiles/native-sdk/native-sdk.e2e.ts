import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../../../src/bin.ts', import.meta.url))
const root = fileURLToPath(new URL('../../../../../../', import.meta.url))

it('serves native SDK prompts with persisted events, status and shutdown', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-native-sdk-'))
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body) as unknown)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"native sdk reply"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model server did not bind')
  const patch = join(home, 'model.patch.json')
  await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [{ id: 'pi-ai', config: {
    providers: { 'deepseek-official': { apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'sdk-fixture' }] } },
  } }] }))
  const child = execa(process.execPath, ['--import', 'tsx/esm', bin, '--profile', 'native-sdk', '--patch', patch], {
    cwd: root, env: { DSH_HOME: home, DEEPSEEK_API_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  let stderr = ''
  let exited = false
  const frames: Record<string, unknown>[] = []
  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) frames.push(JSON.parse(line) as Record<string, unknown>)
  })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  void child.then(() => { exited = true }, () => { exited = true })
  const receive = async (predicate: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 20_000
    for (;;) {
      const index = frames.findIndex(predicate)
      if (index >= 0) return frames.splice(index, 1)[0]!
      if (exited) throw new Error(`native SDK exited before response: ${stderr}`)
      if (Date.now() > deadline) throw new Error(`native SDK response timed out: ${stderr}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { cwd: root, provider: 'deepseek-official', model: 'sdk-fixture' } })}\n`)
    expect(await receive(frame => frame.id === 1)).toMatchObject({
      result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } },
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'session/prompt',
      params: { sessionId: 'sdk-test', contentBlocks: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }] } })}\n`)
    expect(await receive(frame => frame.id === 5)).toMatchObject({ error: { message: expect.stringContaining('text contentBlocks') as unknown } })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt',
      params: { sessionId: 'sdk-test', contentBlocks: [{ type: 'text', text: 'say hello' }] } })}\n`)
    expect(await receive(frame => frame.id === 2)).toMatchObject({ result: { messageId: expect.any(String) as unknown } })
    expect(await receive(frame => frame.method === 'session.event'
      && (frame.params as { event?: { type?: string } }).event?.type === 'turn/end')).toMatchObject({
      params: { sessionId: 'sdk-test', event: { type: 'turn/end' } },
    })
    expect(await receive(frame => frame.method === 'session.status'
      && (frame.params as { status?: string }).status === 'idle')).toMatchObject({ params: { sessionId: 'sdk-test' } })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'session/prompt',
      params: { sessionId: 'sdk-test', contentBlocks: [{ type: 'text', text: 'continue' }] } })}\n`)
    expect(await receive(frame => frame.id === 4)).toMatchObject({ result: { messageId: expect.any(String) as unknown } })
    await receive(frame => frame.method === 'session.event'
      && (frame.params as { event?: { type?: string } }).event?.type === 'turn/end')
    await receive(frame => frame.method === 'session.status'
      && (frame.params as { status?: string }).status === 'idle')
    expect(requests).toHaveLength(2)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' })}\n`)
    expect(await receive(frame => frame.id === 3)).toMatchObject({ result: {} })
    const exit = await child
    expect(exit.exitCode, stderr).toBe(0)
  } finally {
    child.kill('SIGKILL')
    await child
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    await rm(home, { recursive: true, force: true })
  }
}, 35_000)
