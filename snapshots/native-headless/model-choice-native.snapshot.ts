/** Actual model selection, prepared HTTP controls and durable notice through the public dsh profile. */
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm/native'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/model-choice-native')

it('records a selected model and its prepared controls through dsh and cold-replays the same Session', async () => {
  const expected = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(expected) ? parseSessionLog(readFileSync(expected, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'Read fixture.txt, then confirm its contents.'
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const replies: ContentBlock[][] = script === undefined ? [
    [{ type: 'tool-call', id: ToolCallId('choice-read-1'), name: 'read_file', arguments: '{"path":"fixture.txt"}' }],
    [{ type: 'text', text: 'The selected model read the fixture.' }],
  ] : script.map((entry) => {
    if (entry.kind !== 'chunks') throw new Error('model-choice-native: expected a complete recorded response')
    return entry.chunks.flatMap(chunk => chunk.type === 'block-end' ? [chunk.block] : [])
  })
  const requests: { model: string; max_tokens: number; messages: { role: string; content: unknown }[] }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const bytes = Buffer.concat(chunks)
      const body = request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(bytes) : bytes
      requests.push(JSON.parse(body.toString('utf8')) as typeof requests[number])
      const blocks = replies[requests.length - 1]
      if (blocks === undefined) { response.writeHead(500); response.end('script exhausted'); return }
      const tools = blocks.filter(block => block.type === 'tool-call')
      const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('')
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text,
          ...tools.length === 0 ? {} : { tool_calls: tools.map((tool, index) => ({ index, id: tool.id, type: 'function',
            function: { name: tool.name, arguments: tool.arguments } })) } }, finish_reason: null }] }),
        JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tools.length === 0 ? 'stop' : 'tool_calls' }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }), '[DONE]',
      ].map(event => 'data: ' + event + '\n\n').join(''))
    })
  })
  await new Promise<undefined>(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model-choice-native: missing HTTP port')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-model-choice-'))
  const profile = join(home, 'profiles/native-model-choice')
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const modules = join(profile, 'node_modules/@deepseek-ai')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(modules, { recursive: true })
  writeFileSync(join(workspace, 'fixture.txt'), 'Durable model selection fixture.\n')
  for (const name of ['package.json', 'rsh.profile.json']) {
    copyFileSync(join(root, 'rsh/Programs/CLI/tests/profiles/native-model-choice', name), join(profile, name))
  }
  for (const [name, path] of [
    ['native-headless', 'rsh/Engine/core/native-headless'], ['native-agent', 'rsh/Engine/core/native-agent'],
    ['native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['native-session-execution', 'rsh/Engine/core/native-session-execution'],
    ['native-model-selection', 'rsh/Engine/llm/native-model-selection'], ['launch-environment', 'rsh/Core/util/launch-environment'],
    ['credentials-local', 'rsh/Modules/Official/credentials/credentials-local'],
    ['session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['fs-local', 'rsh/Modules/Official/fs/fs-local'], ['fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['llm-pi-ai', 'rsh/Engine/llm/llm-pi-ai'],
  ] as const) symlinkSync(join(root, path), join(modules, 'dsh-' + name), 'junction')
  const fixture = join(profile, 'node_modules/native-selection-fixture')
  mkdirSync(fixture)
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'native-selection-fixture', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['activeSessions', 'modelSelection'], optional: [], provides: [] } } }))
  copyFileSync(join(root, 'rsh/Engine/llm/native-model-selection/tests/fixtures/selection-policy.mjs'), join(fixture, 'native.mjs'))
  const patch = join(home, 'patch.json')
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { cwd: workspace, provider: 'selection-fixture', model: 'first',
      systemPrompt: 'Read fixture.txt, then continue with the selected model.', maxSteps: 3 } },
    { id: 'fs', config: { cwd: workspace } }, { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'credentials', config: { dshHome: home, watch: false } },
    { id: 'model', config: { providers: { 'selection-fixture': { baseURL: 'http://127.0.0.1:' + address.port + '/v1',
      apiKeyEnv: 'MODEL_CHOICE_KEY', api: 'openai-completions', compat: { maxTokensField: 'max_tokens' }, models: [
        { id: 'first', name: 'First', input: ['text'], contextWindow: 32768, maxTokens: 64 },
        { id: 'second', name: 'Second', input: ['text'], contextWindow: 32768, maxTokens: 128 },
      ] } } } },
  ] }))
  try {
    const result = await execa(process.execPath, [
      '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-model-choice', '--patch', patch, task,
    ], { env: { ...process.env, DSH_HOME: home, MODEL_CHOICE_KEY: 'model-choice-key' }, reject: false, timeout: 30_000 })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests.map(request => [request.model, request.max_tokens])).toEqual([['first', 64], ['second', 128]])
    const physicalName = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (physicalName === undefined) throw new Error('model-choice-native: missing durable Session')
    const physical = join(sessions, String(physicalName))
    const raw = readFileSync(physical, 'utf8')
    const events = parseSessionLog(raw)
    expect(events.filter(event => event.type === 'model/selection')).toMatchObject([{ data: { provider: 'selection-fixture', model: 'second' } }])
    const headers = events.filter(event => event.type === 'request/header')
    expect(headers.map(event => [event.data.header.config.model, event.data.header.config.maxTokens])).toEqual([['first', 64], ['second', 128]])
    const notice = events.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === 'model-selection')
    expect(notice).toBeDefined()
    expect(JSON.stringify(requests[1]?.messages)).toContain('[model changed: assistant turns above this point were generated by first; the session continues with second]')
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const cold = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await cold.list())[0]?.header.id
      if (id === undefined) throw new Error('model-choice-native: missing cold Session')
      const reader = await cold.open(id, 'read')
      try { expect((await reader.read()).events).toEqual(events) }
      finally { await reader.close() }
    } finally { await cold.close() }
    expect(readFileSync(physical, 'utf8')).toBe(raw)
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context), schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('model-choice-native: missing request header')
    const prompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(expected, normalized)
      writeFileSync(join(scene, 'system-prompt.expected.md'), prompt)
      writeFileSync(join(scene, 'tool-schemas.expected.json'), tools)
    } else {
      expect(normalized).toBe(readFileSync(expected, 'utf8'))
      expect(prompt).toBe(readFileSync(join(scene, 'system-prompt.expected.md'), 'utf8'))
      expect(tools).toBe(readFileSync(join(scene, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally {
    server.closeAllConnections()
    await new Promise<undefined>(resolve => server.close(() => resolve(undefined)))
    rmSync(home, { recursive: true, force: true })
  }
})
