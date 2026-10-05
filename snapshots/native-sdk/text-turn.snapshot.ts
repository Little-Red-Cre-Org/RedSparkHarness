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
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text', 'image'] }] } } } },
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
      await expect(session.steer('idle steering')).rejects.toThrow()
      const chunk = Promise.withResolvers<void>()
      const pending = session.run(task, { onNotification: notification => {
        if (notification.method === 'session.chunk' && (notification.params.chunk as { type?: string }).type === 'text-delta') chunk.resolve()
      } })
      await chunk.promise
      await expect(harness.session('unknown-session').steer('foreign steering')).rejects.toThrow()
      const steering = await session.steer('redirect after cancellation')
      expect(steering).not.toBe('')
      expect(await harness.session('unknown-session').cancel()).toBe(false)
      expect(await session.cancel()).toBe(true)
      const cancelled = await pending
      expect(cancelled.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
      expect(cancelled.events.some(event => event.type === 'assistant/attempt')).toBe(true)
      expect(cancelled.events.some(event => event.type === 'agent/inbox/spliced' && event.data.target === 'next-step'
        && event.data.inserted.some(message => message.id === steering))).toBe(true)
      await expect(session.steer('settled steering')).rejects.toThrow()
      await harness.close()
      const resumed = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try {
        result = await resumed.run('finish after cancellation', { sessionId: 'sdk-recorded-turn' })
        const source = resumed.session('sdk-recorded-turn')
        await expect(source.fork('sdk-recorded-turn')).rejects.toThrow()
        await expect(source.fork('sdk-recorded-fork', Number.MAX_SAFE_INTEGER)).rejects.toThrow()
        const anchor = result.events.at(-1)?.seq
        if (anchor === undefined) throw new Error('native-sdk snapshot: fork anchor missing')
        const fork = await source.fork('sdk-recorded-fork', anchor)
        expect(fork.id).toBe('sdk-recorded-fork')
        expect(requests).toHaveLength(2)
      }
      finally { await resumed.close() }
      const forked = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try {
        const session = forked.session('sdk-recorded-fork')
        const data = readFileSync(join(scene, 'image.png')).toString('base64')
        await expect(session.run([{ type: 'image', data: 'invalid', mimeType: 'image/png' }])).rejects.toThrow()
        await expect(session.run([{ type: 'image', data, mimeType: 'image/jpeg' }])).rejects.toThrow()
        expect(requests).toHaveLength(2)
        result = await session.run([{ type: 'text', text: 'finish the cold fork' }, { type: 'image', data, mimeType: 'image/png' }])
      }
      finally { await forked.close() }
      const restored = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try { result = await restored.session('sdk-recorded-fork').run('retain the image') }
      finally { await restored.close() }
    }
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests).toHaveLength(4)
    const request = requests[1]
    if (request === undefined) throw new Error('native-sdk snapshot: model request missing')
    const modelInput = JSON.stringify({ model: request.model, messages: request.messages, tools: request.tools ?? [] }, null, 2) + '\n'
    const logs = readdirSync(sessions, { recursive: true }).filter(name => String(name).endsWith('session.v3.jsonl'))
      .map(name => readFileSync(join(sessions, String(name)), 'utf8'))
    const findLog = (id: string): string => {
      const raw = logs.find(log => (JSON.parse(log.split('\n')[0] ?? '{}') as { id: string }).id === id)
      if (raw === undefined) throw new Error(`native-sdk snapshot: durable Session missing: ${id}`)
      return raw
    }
    const raw = findLog('sdk-recorded-turn')
    const forkRaw = findLog('sdk-recorded-fork')
    expect(logs).toHaveLength(2)
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const forkContext = { cwd: workspace, sessionIds: [] }
    const normalizedFork = normalizeSessionSnapshot(redactSessionSnapshotIds([forkRaw])[0] ?? forkRaw,
      forkContext, { identityMode: 'preserve' })
    const forkRequest = requests[3]
    if (forkRequest === undefined) throw new Error('native-sdk snapshot: fork model request missing')
    const imageMessage = parseSessionLog(forkRaw).find(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'image'))
    const image = imageMessage?.type === 'user/message' ? imageMessage.data.content.find(block => block.type === 'image') : undefined
    if (image?.type !== 'image') throw new Error('native-sdk snapshot: durable image reference missing')
    const digest = image.attachment.attachmentId.slice('sha256:'.length)
    const objectPath = ['attachments', 'v1', 'objects', digest.slice(0, 2), digest]
    const quotedHostPath = JSON.stringify(join(home, ...objectPath))
    const quotedFixturePath = JSON.stringify(`{{home}}/${objectPath.join('/')}`)
    const forkModelInput = JSON.stringify({ model: forkRequest.model, messages: forkRequest.messages,
      tools: forkRequest.tools ?? [] }, (_key, value: unknown) => typeof value === 'string'
      ? value.replace(quotedHostPath, quotedFixturePath) : value, 2) + '\n'
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-sdk snapshot: request header missing')
    const systemPrompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(fixture, normalized)
      writeFileSync(join(scene, 'fork-session.v3.jsonl'), normalizedFork)
      writeFileSync(join(scene, 'fork-model-request.expected.json'), forkModelInput)
      writeFileSync(join(scene, 'model-request.expected.json'), modelInput)
      writeFileSync(join(scene, 'system-prompt.expected.md'), systemPrompt)
      writeFileSync(join(scene, 'tool-schemas.expected.json'), tools)
    } else {
      expect(normalized).toBe(readFileSync(fixture, 'utf8'))
      expect(normalizedFork).toBe(readFileSync(join(scene, 'fork-session.v3.jsonl'), 'utf8'))
      expect(forkModelInput).toBe(readFileSync(join(scene, 'fork-model-request.expected.json'), 'utf8'))
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
