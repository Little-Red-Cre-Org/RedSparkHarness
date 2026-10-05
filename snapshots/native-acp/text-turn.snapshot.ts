/** One recorded native ACP turn through the shipped dsh profile and standard protocol. */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-json-rpc-line'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { requestImageHandleText } from '@deepseek-ai/dsh-llm/native'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-acp/text-turn')
const fixture = join(scene, 'session.v3.jsonl')

it('replays a native ACP turn with exact model input, output and durable Session events', async () => {
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const answer = recorded?.find(event => event.type === 'assistant/message')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'say hello through native ACP'
  const reply = answer?.type === 'assistant/message' && answer.data.message.content[0]?.type === 'text'
    ? answer.data.message.content[0].text : 'native ACP snapshot reply'
  const requests: Record<string, unknown>[] = []
  let permissionTurn = false
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body) as Record<string, unknown>
      requests.push(payload)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const messages = payload.messages as readonly { role: string }[]
      const events = permissionTurn && messages.at(-1)?.role !== 'tool'
        ? [{ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'permission-proof-call', type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path: 'permission-proof.txt', content: 'approved' }) } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        : [
        { choices: [{ delta: { role: 'assistant', content: reply } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]
      response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-acp snapshot: missing model endpoint')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-acp-snapshot-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'You are a native ACP fixture.', maxSteps: 2 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text', 'image'] },
        { id: 'fixture-model-next', input: ['text', 'image'], reasoningEfforts: { off: null, high: 'high' } }] } } } },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-acp', '--patch', patch], {
    cwd: workspace, env: { ...process.env, DSH_HOME: home, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  const output: Record<string, unknown>[] = []
  transport.onNotification((method, params) => {
    if (method === 'session/update') output.push(params.update as Record<string, unknown>)
  })
  transport.onRequest((method, params) => {
    expect(method).toBe('session/request_permission')
    expect(output.at(-1)).toMatchObject({ sessionUpdate: 'tool_call', toolCallId: 'permission-proof-call' })
    expect(params.options).toMatchObject([{ optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'reject-once', kind: 'reject_once' }])
    return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
  })
  transport.start()
  const signal = AbortSignal.timeout(20_000)
  try {
    const initialized = await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal)
    expect(initialized).toMatchObject({ agentCapabilities: { promptCapabilities: { image: true } } })
    const created = await transport.request('session/new', { cwd: workspace, mcpServers: [] }, signal) as {
      sessionId: string; configOptions: { id: string; currentValue: string }[] }
    expect(created.configOptions[0]?.currentValue).toBe(JSON.stringify(['fixture', 'fixture-model']))
    await expect(transport.request('session/set_config_option', { sessionId: created.sessionId,
      configId: 'model', value: 'not-an-advertised-route' }, signal)).rejects.toThrow()
    await transport.request('session/set_config_option', { sessionId: created.sessionId,
      configId: 'model', value: JSON.stringify(['fixture', 'fixture-model-next']) }, signal)
    await transport.request('session/set_config_option', { sessionId: created.sessionId,
      configId: 'reasoning_effort', value: 'high' }, signal)
    const image = readFileSync(join(scene, 'image.png')).toString('base64')
    const result = await transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: task }, { type: 'image', mimeType: 'image/png', data: image }] }, signal)
    expect(result).toMatchObject({ stopReason: 'end_turn' })
    expect(output).toMatchObject([{ sessionUpdate: 'config_option_update' }, { sessionUpdate: 'config_option_update' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } }])
    const protocol = JSON.stringify(output.map(({ messageId: _messageId, ...update }) => update), null, 2) + '\n'
    await transport.request('session/close', { sessionId: created.sessionId }, signal)
    const listed = await transport.request('session/list', { cwd: workspace }, signal) as { sessions: unknown[] }
    expect(listed.sessions).toHaveLength(1)
    expect(await transport.request('session/resume', { sessionId: created.sessionId, cwd: workspace, mcpServers: [] }, signal))
      .toMatchObject({ configOptions: [{ id: 'model', currentValue: JSON.stringify(['fixture', 'fixture-model-next']) },
        { id: 'reasoning_effort', currentValue: 'high' }] })
    expect(output).toHaveLength(4)
    expect(requests).toHaveLength(1)
    const request = requests[0]
    if (request === undefined) throw new Error('native-acp snapshot: model request missing')
    const physical = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (physical === undefined) throw new Error('native-acp snapshot: durable Session missing')
    const raw = readFileSync(join(sessions, String(physical)), 'utf8')
    const imageEvent = parseSessionLog(raw).find(event => event.type === 'user/message')
    const imageBlock = imageEvent?.type === 'user/message' ? imageEvent.data.content.find(block => block.type === 'image') : undefined
    if (imageBlock?.type !== 'image') throw new Error('native-acp snapshot: durable image missing')
    const ref = imageBlock.attachment
    const digest = String(ref.attachmentId).slice('sha256:'.length)
    const attachmentPath = join(home, 'attachments', 'v1', 'objects', digest.slice(0, 2), digest)
    const storedImage = readFileSync(attachmentPath)
    expect(`sha256:${createHash('sha256').update(storedImage).digest('hex')}`).toBe(ref.attachmentId)
    const caption = requestImageHandleText(ref, ref, { readonlyPath: attachmentPath })
    const stableCaption = requestImageHandleText(ref, ref, { readonlyPath: '{{attachment}}' })
    expect(request).toMatchObject({ model: 'fixture-model-next', reasoning_effort: 'high' })
    const serialized = JSON.stringify({ model: request.model, reasoning_effort: request.reasoning_effort,
      messages: request.messages, tools: request.tools ?? [] }, null, 2)
    expect(serialized.split(JSON.stringify(caption))).toHaveLength(2)
    expect(request.messages).toMatchObject([{ role: 'developer' }, { role: 'user', content: [
      { type: 'text', text: task }, { type: 'text', text: caption },
      { type: 'image_url', image_url: { url: `data:${ref.mediaType};base64,${storedImage.toString('base64')}` } },
    ] }])
    const modelInput = serialized.replace(JSON.stringify(caption), JSON.stringify(stableCaption)) + '\n'
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-acp snapshot: request header missing')
    const systemPrompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(join(scene, 'protocol.expected.json'), protocol)
      writeFileSync(fixture, normalized)
      writeFileSync(join(scene, 'model-request.expected.json'), modelInput)
      writeFileSync(join(scene, 'system-prompt.expected.md'), systemPrompt)
      writeFileSync(join(scene, 'tool-schemas.expected.json'), tools)
    } else {
      expect(protocol).toBe(readFileSync(join(scene, 'protocol.expected.json'), 'utf8'))
      expect(normalized).toBe(readFileSync(fixture, 'utf8'))
      expect(modelInput).toBe(readFileSync(join(scene, 'model-request.expected.json'), 'utf8'))
      expect(systemPrompt).toBe(readFileSync(join(scene, 'system-prompt.expected.md'), 'utf8'))
      expect(tools).toBe(readFileSync(join(scene, 'tool-schemas.expected.json'), 'utf8'))
    }
    const beforePermission = output.length
    permissionTurn = true
    expect(await transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'write permission-proof.txt after one-shot approval' }] }, signal)).toMatchObject({ stopReason: 'end_turn' })
    expect(readFileSync(join(workspace, 'permission-proof.txt'), 'utf8')).toBe('approved')
    expect(requests).toHaveLength(3)
    const permissionLog = readFileSync(join(sessions, String(physical)), 'utf8')
    const decisions = parseSessionLog(permissionLog).filter(event => event.type === 'native-approval/decided')
    expect(decisions).toMatchObject([{ data: { outcome: 'allowed-once' } }])
    const permissionScene = join(root, 'snapshots/native-acp/permissions-turn')
    const expectations = {
      'session.v3.jsonl': normalizeSessionSnapshot(redactSessionSnapshotIds([permissionLog])[0] ?? permissionLog, context, { identityMode: 'preserve' }),
      'protocol.expected.json': JSON.stringify(output.slice(beforePermission).map(({ messageId: _messageId, ...update }) => update), null, 2) + '\n',
      'model-request.expected.json': JSON.stringify(requests.slice(1).map(request => ({ model: request.model,
        messages: request.messages, tools: request.tools ?? [] })), null, 2).replaceAll(JSON.stringify(caption), JSON.stringify(stableCaption)) + '\n',
    }
    for (const [name, expected] of Object.entries(expectations)) {
      if (process.env.DSH_SNAPSHOT === 'refresh') {
        mkdirSync(permissionScene, { recursive: true })
        writeFileSync(join(permissionScene, name), expected)
      } else expect(expected).toBe(readFileSync(join(permissionScene, name), 'utf8'))
    }
  } finally {
    child.stdin.end()
    const exited = await child
    transport.close()
    expect(exited.exitCode, exited.stderr).toBe(0)
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
})
