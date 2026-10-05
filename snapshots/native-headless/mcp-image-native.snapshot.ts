/** Public MCP image tools with real transport, Pi Provider, durable bytes and cold replay. */
import { createHash } from 'node:crypto'
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
import { LocalAttachmentBackend } from '@deepseek-ai/dsh-attachment-local/backend'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/mcp-image-native')

it('calls a real MCP image tool through dsh, persists attachments and cold-replays the log', async () => {
  const expected = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(expected) ? parseSessionLog(readFileSync(expected, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'Call the MCP image tool, then confirm the image is available.'
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const replies: ContentBlock[][] = script === undefined ? [
    [{ type: 'tool-call', id: ToolCallId('image-read-1'), name: 'mcp__fixture__image', arguments: '{}' }],
    [{ type: 'text', text: 'The PNG attachment is available.' }],
  ] : script.map((entry) => {
    if (entry.kind !== 'chunks') throw new Error('mcp-image-native: expected a complete recorded response')
    return entry.chunks.flatMap(chunk => chunk.type === 'block-end' ? [chunk.block] : [])
  })
  const requests: { model: string; messages: { role: string; content: unknown }[] }[] = []
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
  if (address === null || typeof address === 'string') throw new Error('mcp-image-native: missing HTTP port')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-mcp-image-'))
  const profile = join(home, 'profiles/native-mcp-image')
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const modules = join(profile, 'node_modules/@deepseek-ai')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(modules, { recursive: true })
  for (const name of ['package.json', 'rsh.profile.json']) {
    copyFileSync(join(root, 'rsh/Programs/CLI/tests/profiles/native-mcp-image', name), join(profile, name))
  }
  for (const [name, path] of [
    ['native-headless', 'rsh/Engine/core/native-headless'], ['native-agent', 'rsh/Engine/core/native-agent'],
    ['native-tools', 'rsh/Engine/core/native-tools'], ['native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['native-prompt', 'rsh/Engine/core/native-prompt'], ['launch-environment', 'rsh/Core/util/launch-environment'],
    ['credentials-local', 'rsh/Modules/Official/credentials/credentials-local'],
    ['session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['fs-local', 'rsh/Modules/Official/fs/fs-local'], ['fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['attachment-local', 'rsh/Modules/Official/attachment/attachment-local'], ['mcp-client', 'rsh/Modules/Official/mcp/mcp-client'],
    ['llm-pi-ai', 'rsh/Engine/llm/llm-pi-ai'],
  ] as const) symlinkSync(join(root, path), join(modules, 'dsh-' + name), 'junction')
  const patch = join(home, 'patch.json')
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { cwd: workspace, provider: 'native-image-fixture', model: 'vision-fixture',
      systemPrompt: 'Use the registered MCP image tool.', maxSteps: 3, builtinTools: false } }, { id: 'fs', config: { cwd: workspace } },
    { id: 'storage', config: { root: sessions, compression: 'none' } }, { id: 'attachments', config: { dshHome: home } },
    { id: 'mcp', config: { transport: 'stdio', serverName: 'fixture', command: process.execPath,
      args: ['--import', 'tsx/esm', join(root, 'rsh/Modules/Official/mcp/mcp-client/tests/fixture-server.ts')],
      cwd: root, env: {}, toolCallTimeoutMs: 10000, failOnStartupError: true, reconnect: { enabled: false } } },
    { id: 'credentials', config: { dshHome: home, watch: false } },
    { id: 'model', config: { providers: { 'native-image-fixture': { baseURL: 'http://127.0.0.1:' + address.port + '/v1',
      apiKeyEnv: 'NATIVE_IMAGE_KEY', api: 'openai-completions', models: [{ id: 'vision-fixture', name: 'Fixture vision',
        input: ['text', 'image'], contextWindow: 4096, maxTokens: 512 }] } } } },
  ] }))
  try {
    const result = await execa(process.execPath, [
      '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-mcp-image', '--patch', patch, task,
    ], { env: { ...process.env, DSH_HOME: home, NATIVE_IMAGE_KEY: 'native-image-fixture-key' }, reject: false, timeout: 30_000 })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests.map(request => request.model)).toEqual(['vision-fixture', 'vision-fixture'])
    const physicalName = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (physicalName === undefined) throw new Error('mcp-image-native: missing durable Session')
    const physical = join(sessions, String(physicalName))
    const raw = readFileSync(physical, 'utf8')
    const events = parseSessionLog(raw)
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.content[0]).toMatchObject({ type: 'tool-result', isError: false })
    const image = results[0]?.data.message.content.flatMap(block => block.type === 'tool-result' ? block.content : [])
      .find(block => block.type === 'image')
    if (image?.type !== 'image') throw new Error('mcp-image-native: image was not persisted in the tool result')
    const attachments = new LocalAttachmentBackend({ dshHome: home })
    const stored = await attachments.readImage(image.attachment)
    expect(stored.data.byteLength).toBe(image.attachment.bytes)
    expect(image.attachment.attachmentId).toContain(createHash('sha256').update(stored.data).digest('hex'))
    const wire = JSON.stringify(requests[1]?.messages)
    expect(wire).toContain('data:image/png;base64,')
    const encodedImage = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(wire)?.[1]
    if (encodedImage === undefined) throw new Error('mcp-image-native: model request omitted image bytes')
    expect(Buffer.from(encodedImage, 'base64')).toEqual(Buffer.from(stored.data))
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const cold = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await cold.list())[0]?.header.id
      if (id === undefined) throw new Error('mcp-image-native: missing cold Session')
      const reader = await cold.open(id, 'read')
      try { expect((await reader.read()).events).toEqual(events) }
      finally { await reader.close() }
    } finally { await cold.close() }
    expect(readFileSync(physical, 'utf8')).toBe(raw)
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context), schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('mcp-image-native: missing request header')
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
