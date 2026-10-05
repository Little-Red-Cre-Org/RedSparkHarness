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

it('cancels a running ACP prompt, rejects overlap and drains an active prompt on EOF', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-acp-lifecycle-'))
  let entered = Promise.withResolvers<undefined>()
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"role":"assistant","content":"partial"}}]}\n\n')
    entered.resolve(undefined)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model endpoint did not bind')
  const patch = join(home, 'model.patch.json')
  await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'ACP lifecycle fixture', maxSteps: 1 } },
    { id: 'storage', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_ACP_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model' }] } } } },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-acp', '--patch', patch], {
    cwd: home, env: { DSH_HOME: home, NATIVE_ACP_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  transport.start()
  const signal = AbortSignal.timeout(20_000)
  try {
    await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal)
    const created = await transport.request('session/new', { cwd: home, mcpServers: [] }, signal) as { sessionId: string }
    const params = { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'wait until cancelled' }] }
    const prompt = transport.request('session/prompt', params, signal)
    await entered.promise
    await expect(transport.request('session/prompt', params, signal)).rejects.toThrow('session prompt is already running')
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await transport.flush()
    expect(await prompt).toMatchObject({ stopReason: 'cancelled' })
    entered = Promise.withResolvers<undefined>()
    const pending = transport.request('session/prompt', params, signal).catch((error: unknown) => error)
    await entered.promise
    child.stdin.end()
    const exit = await child
    expect(exit.exitCode, exit.stderr).toBe(0)
    await pending
    const paths = await readdir(join(home, 'sessions'), { recursive: true })
    const physical = paths.find(path => path.endsWith('session.v3.jsonl'))
    if (physical === undefined) throw new Error('durable ACP Session missing')
    const events = (await readFile(join(home, 'sessions', physical), 'utf8')).trim().split('\n').slice(1)
      .map(line => JSON.parse(line) as { type: string; data: { reason?: { kind: string } } })
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
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
