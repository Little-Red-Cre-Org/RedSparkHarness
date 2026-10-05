/** One recorded native SDK text turn through the shipped dsh profile and TypeScript client. */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { execa } from 'execa'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-sdk/text-turn')
const fixture = join(scene, 'session.v3.jsonl')

it('replays a native SDK turn with exact model input, output and durable Session events', async () => {
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const answer = recorded?.find(event => event.type === 'assistant/message')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'say hello through native SDK'
  const reply = answer?.type === 'assistant/message' && answer.data.message.content[0]?.type === 'text'
    ? answer.data.message.content[0].text : 'native SDK snapshot reply'
  const requests: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (requests.length === 1) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: reply } }] })}\n\n`)
        return
      }
      response.end([
        { choices: [{ delta: { role: 'assistant', content: reply } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-sdk snapshot: missing model endpoint')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-sdk-snapshot-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'You are a native SDK fixture.', maxSteps: 1 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model' }] } } } },
  ] }))
  const harness = new DeepSeekHarness({ profile: 'native-sdk', dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    dshHome: home, patches: [patch], cwd: workspace, provider: 'fixture', model: 'fixture-model',
    env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    requestTimeoutMs: 20_000 })
  try {
    let result
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
      writeFileSync(launcher, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" "$@"\n`)
      if (process.platform !== 'win32') chmodSync(launcher, 0o700)
      const python = await execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(scene, 'client.py'), launcher, home, workspace, patch, task], {
        env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'), NATIVE_SDK_FIXTURE_KEY: 'fixture-key' },
        timeout: 30000,
      })
      result = JSON.parse(python.stdout) as { finalResponse: string; events: Array<{type: string; data: unknown}> }
    } else {
      const session = harness.session('sdk-recorded-turn')
      expect(await session.cancel()).toBe(false)
      const chunk = Promise.withResolvers<void>()
      const pending = session.run(task, { onNotification: notification => {
        if (notification.method === 'session.chunk' && (notification.params.chunk as { type?: string }).type === 'text-delta') chunk.resolve()
      } })
      await chunk.promise
      expect(await harness.session('unknown-session').cancel()).toBe(false)
      expect(await session.cancel()).toBe(true)
      const cancelled = await pending
      expect(cancelled.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
      expect(cancelled.events.some(event => event.type === 'assistant/attempt')).toBe(true)
      await harness.close()
      const resumed = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try { result = await resumed.run('finish after cancellation', { sessionId: 'sdk-recorded-turn' }) }
      finally { await resumed.close() }
    }
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests).toHaveLength(2)
    const request = requests[1]
    if (request === undefined) throw new Error('native-sdk snapshot: model request missing')
    const modelInput = JSON.stringify({ model: request.model, messages: request.messages, tools: request.tools ?? [] }, null, 2) + '\n'
    const physical = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (physical === undefined) throw new Error('native-sdk snapshot: durable Session missing')
    const raw = readFileSync(join(sessions, String(physical)), 'utf8')
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-sdk snapshot: request header missing')
    const systemPrompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(fixture, normalized)
      writeFileSync(join(scene, 'model-request.expected.json'), modelInput)
      writeFileSync(join(scene, 'system-prompt.expected.md'), systemPrompt)
      writeFileSync(join(scene, 'tool-schemas.expected.json'), tools)
    } else {
      expect(normalized).toBe(readFileSync(fixture, 'utf8'))
      expect(modelInput).toBe(readFileSync(join(scene, 'model-request.expected.json'), 'utf8'))
      expect(systemPrompt).toBe(readFileSync(join(scene, 'system-prompt.expected.md'), 'utf8'))
      expect(tools).toBe(readFileSync(join(scene, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally {
    await harness.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
})
