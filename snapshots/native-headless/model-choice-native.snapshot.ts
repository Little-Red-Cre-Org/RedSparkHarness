/** Actual model selection, prepared HTTP controls and durable notice through the public dsh profile. */
import { copyFileSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm/native'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))

interface ModelChoicePatch {
  readonly defaultModel: string
  readonly firstMaxTokens: number
  readonly secondMaxTokens: number
  readonly systemPrompt?: string
  readonly disableSelectionFixture?: boolean
}

interface ModelChoiceRequest {
  model: string
  max_tokens: number
  messages: { role: string; content: unknown }[]
}

interface ModelChoiceRunner {
  readonly home: string
  readonly workspace: string
  readonly sessions: string
  readonly requests: ModelChoiceRequest[]
  writePatch(path: string, patch: ModelChoicePatch): void
  invoke(patch: string, args: readonly string[]): Promise<{ exitCode?: number | null; stderr: string }>
}

function modelReplies(recorded: ReturnType<typeof parseSessionLog> | undefined, seeded: ContentBlock[][],
  scenario: string): ContentBlock[][] {
  if (recorded === undefined) return seeded
  return deriveReplayScript(recorded).map((entry) => {
    if (entry.kind !== 'chunks') throw new Error(`${scenario}: expected a complete recorded response`)
    return entry.chunks.flatMap(chunk => chunk.type === 'block-end' ? [chunk.block] : [])
  })
}

async function withModelChoiceRunner(replies: ContentBlock[][],
  run: (runner: ModelChoiceRunner) => Promise<void>): Promise<void> {
  const requests: ModelChoiceRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const bytes = Buffer.concat(chunks)
      const body = request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(bytes) : bytes
      requests.push(JSON.parse(body.toString('utf8')) as ModelChoiceRequest)
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
  let home: string | undefined
  const junctions: string[] = []
  try {
    await new Promise<undefined>(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('model-choice-native: missing HTTP port')
    const selectedHome = mkdtempSync(join(tmpdir(), 'dsh-native-model-choice-'))
    home = selectedHome
    const profile = join(selectedHome, 'profiles/native-model-choice')
    const workspace = join(selectedHome, 'workspace')
    const sessions = join(selectedHome, 'sessions')
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
      ['llm-pi-ai', 'rsh/Modules/Official/llm/llm-pi-ai'],
    ] as const) {
      const junction = join(modules, 'dsh-' + name)
      symlinkSync(join(root, path), junction, 'junction')
      junctions.push(junction)
    }
    const fixture = join(profile, 'node_modules/native-selection-fixture')
    mkdirSync(fixture)
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'native-selection-fixture', version: '0.0.0', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['activeSessions', 'modelSelection'], optional: [], provides: [] } } }))
    copyFileSync(join(root, 'rsh/Engine/llm/native-model-selection/tests/fixtures/selection-policy.mjs'), join(fixture, 'native.mjs'))
    const runner: ModelChoiceRunner = {
      home: selectedHome, workspace, sessions, requests,
      writePatch(path, patch) {
        writeFileSync(path, JSON.stringify({ formatVersion: 1, installations: [
          { id: 'app', config: { cwd: workspace, provider: 'selection-fixture', model: patch.defaultModel,
            systemPrompt: patch.systemPrompt ?? 'Read fixture.txt, then continue with the selected model.', maxSteps: 3 } },
          { id: 'fs', config: { cwd: workspace } }, { id: 'storage', config: { root: sessions, compression: 'none' } },
          { id: 'credentials', config: { dshHome: selectedHome, watch: false } },
          { id: 'model', config: { providers: { 'selection-fixture': { baseURL: 'http://127.0.0.1:' + address.port + '/v1',
            apiKeyEnv: 'MODEL_CHOICE_KEY', api: 'openai-completions', compat: { maxTokensField: 'max_tokens' }, models: [
              { id: 'first', name: 'First', input: ['text'], contextWindow: 32768, maxTokens: patch.firstMaxTokens },
              { id: 'second', name: 'Second', input: ['text'], contextWindow: 32768, maxTokens: patch.secondMaxTokens },
            ] } } } },
          ...patch.disableSelectionFixture === true ? [{ id: 'selection-fixture', disabled: true }] : [],
        ] }))
      },
      async invoke(patch, args) {
        return await execa(process.execPath, [
          '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
          join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-model-choice', '--patch', patch, ...args,
        ], { env: { ...process.env, DSH_HOME: selectedHome, MODEL_CHOICE_KEY: 'model-choice-key' }, reject: false, timeout: 30_000 })
      },
    }
    await run(runner)
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<undefined>(resolve => server.close(() => resolve(undefined)))
    for (const junction of junctions) if (lstatSync(junction).isSymbolicLink()) unlinkSync(junction)
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
}

function assertModelChoiceSnapshot(scene: string, raw: string, workspace: string): void {
  const expected = join(scene, 'session.v3.jsonl')
  const context = { cwd: workspace, sessionIds: [] }
  const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
  const prompts = normalizedSystemPrompts(raw, context), schemas = normalizedToolSchemas(raw, context)
  if (prompts[0] === undefined || schemas[0] === undefined) throw new Error(`${scene}: missing request header`)
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
}

it('records a selected model and its prepared controls through dsh and cold-replays the same Session', async () => {
  const scene = join(root, 'snapshots/native-headless/model-choice-native')
  const expected = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(expected) ? parseSessionLog(readFileSync(expected, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'Read fixture.txt, then confirm its contents.'
  const replies = modelReplies(recorded, [
    [{ type: 'tool-call', id: ToolCallId('choice-read-1'), name: 'read_file', arguments: '{"path":"fixture.txt"}' }],
    [{ type: 'text', text: 'The selected model read the fixture.' }],
  ], 'model-choice-native')
  await withModelChoiceRunner(replies, async runner => {
    const patch = join(runner.home, 'patch.json')
    runner.writePatch(patch, { defaultModel: 'first', firstMaxTokens: 64, secondMaxTokens: 128 })
    const result = await runner.invoke(patch, [task])
    expect(result.exitCode, result.stderr).toBe(0)
    expect(runner.requests).toHaveLength(2)
    expect(runner.requests.map(request => [request.model, request.max_tokens])).toEqual([['first', 64], ['second', 128]])
    const physicalName = readdirSync(runner.sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (physicalName === undefined) throw new Error('model-choice-native: missing durable Session')
    const physical = join(runner.sessions, String(physicalName))
    const raw = readFileSync(physical, 'utf8')
    const events = parseSessionLog(raw)
    expect(events.filter(event => (event.type as string) === 'model/selection')).toMatchObject([{ data: { provider: 'selection-fixture', model: 'second' } }])
    const headers = events.filter(event => event.type === 'request/header')
    expect(headers.map(event => [event.data.header.config.model, event.data.header.config.maxTokens])).toEqual([['first', 64], ['second', 128]])
    const notice = events.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === 'model-selection')
    expect(notice).toBeDefined()
    expect(JSON.stringify(runner.requests[1]?.messages)).toContain('[model changed: assistant turns above this point were generated by first; the session continues with second]')
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const cold = new JsonlSessionBackend({ root: runner.sessions, compression: 'none' })
    try {
      const id = (await cold.list())[0]?.header.id
      if (id === undefined) throw new Error('model-choice-native: missing cold Session')
      const reader = await cold.open(id, 'read')
      try { expect((await reader.read()).events).toEqual(events) }
      finally { await reader.close() }
    } finally { await cold.close() }
    expect(readFileSync(physical, 'utf8')).toBe(raw)
    assertModelChoiceSnapshot(scene, raw, runner.workspace)
  })
})

it('restores the recorded model route when a cold resume defaults to another model', async () => {
  const scene = join(root, 'snapshots/native-headless/model-history-native')
  const expected = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(expected) ? parseSessionLog(readFileSync(expected, 'utf8')) : undefined
  if (recorded === undefined && process.env.DSH_SNAPSHOT !== 'refresh') {
    throw new Error('model-history-native: canonical Session is required outside refresh')
  }
  let tasks: readonly [string, string]
  if (recorded === undefined) tasks = ['Describe the default model.', 'Continue after the default model changed.']
  else {
    const userMessages = recorded.filter((event): event is Extract<ReturnType<typeof parseSessionLog>[number], { type: 'user/message' }> =>
      event.type === 'user/message' && event.data.source.kind === 'user')
    if (userMessages.length !== 2) throw new Error('model-history-native: canonical Session must contain two user prompts')
    const prompts = userMessages.map(event => {
      const content = event.data.content[0]
      if (content?.type !== 'text') throw new Error('model-history-native: canonical user prompt must be text')
      return content.text
    })
    const first = prompts[0], second = prompts[1]
    if (first === undefined || second === undefined) throw new Error('model-history-native: missing canonical user prompt')
    tasks = [first, second]
  }
  const replies = modelReplies(recorded, [
    [{ type: 'text', text: 'The first default model answered.' }],
    [{ type: 'text', text: 'The historical model answered after resume.' }],
  ], 'model-history-native')
  await withModelChoiceRunner(replies, async runner => {
    const firstPatch = join(runner.home, 'first-patch.json')
    runner.writePatch(firstPatch, { defaultModel: 'first', firstMaxTokens: 64, secondMaxTokens: 128,
      systemPrompt: 'Answer briefly.',
      disableSelectionFixture: true })
    const first = await runner.invoke(firstPatch, [tasks[0]])
    expect(first.exitCode, first.stderr).toBe(0)

    const cold = new JsonlSessionBackend({ root: runner.sessions, compression: 'none' })
    let id: SessionId | undefined
    try { id = (await cold.list())[0]?.header.id }
    finally { await cold.close() }
    if (id === undefined) throw new Error('model-history-native: missing cold Session id')

    const secondPatch = join(runner.home, 'second-patch.json')
    runner.writePatch(secondPatch, { defaultModel: 'second', firstMaxTokens: 96, secondMaxTokens: 128,
      systemPrompt: 'Answer briefly.',
      disableSelectionFixture: true })
    const second = await runner.invoke(secondPatch, ['--resume', id, tasks[1]])
    expect(second.exitCode, second.stderr).toBe(0)
    expect(runner.requests.map(request => [request.model, request.max_tokens])).toEqual([['first', 64], ['first', 96]])

    const physicalName = readdirSync(runner.sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (physicalName === undefined) throw new Error('model-history-native: missing durable Session')
    const physical = join(runner.sessions, String(physicalName))
    const raw = readFileSync(physical, 'utf8')
    const events = parseSessionLog(raw)
    const headers = events.filter(event => event.type === 'request/header')
    expect(headers.map(event => [event.data.header.config.model, event.data.header.config.maxTokens])).toEqual([
      ['first', 64], ['first', 96],
    ])
    expect(events.filter(event => (event.type as string) === 'model/selection')).toEqual([])
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'model-selection')).toEqual([])
    expect(JSON.stringify(runner.requests[1]?.messages)).not.toContain('[model changed:')
    expect(events.filter(event => event.type === 'turn/end')).toMatchObject([
      { data: { reason: { kind: 'completed' } } }, { data: { reason: { kind: 'completed' } } },
    ])
    expect(events.filter(event => event.type === 'assistant/message').map(event => event.data.message.source)).toEqual([
      { kind: 'model', provider: 'selection-fixture', model: 'first' },
      { kind: 'model', provider: 'selection-fixture', model: 'first' },
    ])
    const readerBackend = new JsonlSessionBackend({ root: runner.sessions, compression: 'none' })
    try {
      const reader = await readerBackend.open(id, 'read')
      try { expect((await reader.read()).events).toEqual(events) }
      finally { await reader.close() }
    } finally { await readerBackend.close() }
    expect(readFileSync(physical, 'utf8')).toBe(raw)
    assertModelChoiceSnapshot(scene, raw, runner.workspace)
  })
})
