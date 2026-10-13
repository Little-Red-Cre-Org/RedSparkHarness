/** Records a real fixed-profile ACP child, exact parent approval and external file result. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { NATIVE_ACP_SUBAGENT_METADATA_KEY, readNativeAcpSubagentPermissionRequest, readNativeAcpSubagentPolicy,
  readNativeAcpSubagentServerCapabilities } from '@deepseek-ai/dsh-acp-protocol'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-json-rpc-line'
import { SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot, formatSystemPromptSnapshot,
  formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas, normalizeSessionSnapshot,
  redactSessionSnapshotIds, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'
import { ensureShippedNativeProfile } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-acp/external-child')
const fixture = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const bin = join(root, 'rsh/Programs/CLI/lib/bin.js')
const parentModel = 'native-acp-parent-fixture'
const childModel = 'native-acp-child-fixture'
const writePath = 'approved.txt'
const initialTask = 'Delegate one approved file write to the Native ACP child and report completion.'
const childReply = 'The approved file was written.'
const parentReply = 'The delegated write completed.'

type JsonRecord = Record<string, unknown>

function object(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function textFromContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const block = value.find(item => object(item)?.type === 'text')
  return typeof object(block)?.text === 'string' ? object(block)?.text as string : undefined
}

function callArguments(events: readonly SessionEvent[], name: string): JsonRecord {
  const call = events.find(event => event.type === 'tool/call' && event.data.name === name)
  if (call?.type !== 'tool/call') throw new Error(`native ACP external-child snapshot omitted ${name} call`)
  const parsed: unknown = typeof call.data.arguments === 'string' ? JSON.parse(call.data.arguments) as unknown : call.data.arguments
  const args = object(parsed)
  if (args === undefined) throw new Error(`native ACP external-child snapshot ${name} arguments were not an object`)
  return args
}

function workspaceValues(value: unknown, cwd: string): unknown {
  if (typeof value === 'string') {
    return value.includes(cwd) ? value.replaceAll(cwd, '{{cwd}}').replace(/\{\{cwd\}\}([\\/])([^\s<>"'`]+)/gu,
      (_match, _separator: string, path: string) => `{{cwd}}/${path.replaceAll('\\', '/')}`) : value
  }
  if (Array.isArray(value)) return value.map(item => workspaceValues(item, cwd))
  const row = object(value)
  return row === undefined ? value : Object.fromEntries(Object.entries(row).map(([key, item]) => [key, workspaceValues(item, cwd)]))
}

function installChildObserver(profileDirectory: string): void {
  const directory = join(profileDirectory, 'node_modules', '@fixture', 'acp-child-observer')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: '@fixture/acp-child-observer', version: '1.0.0', type: 'module',
    exports: { './package.json': './package.json', './native.js': './native.js' },
    dsh: { native: { apiVersion: 1, entry: './native.js', targets: ['host'], requires: ['childConnection'], optional: [], provides: [] } },
  }))
  writeFileSync(join(directory, 'native.js'), [
    "import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    'const readSessions = (home, sessionFileName) => {',
    '  const root = join(home, "sessions")',
    '  if (!existsSync(root)) return []',
    '  return readdirSync(root, { recursive: true }).filter(path => String(path).endsWith(sessionFileName))',
    '    .map(path => ({ path: String(path), raw: readFileSync(join(root, String(path)), "utf8") }))',
    '}',
    'export const plugin = {',
    "  apiVersion: 1, name: '@fixture/acp-child-observer', targets: ['host'], requires: ['childConnection'], optional: [], provides: [],",
    '  resolve(config) {',
    '    return context => {',
    "      const service = context.require('childConnection')",
    '      const originalConnect = service.connect',
    '      const connections = []',
    '      const persist = () => writeFileSync(config.observationPath, JSON.stringify({ connections }))',
    '      service.connect = function (spec) {',
    '        const handle = originalConnect.call(this, spec)',
    "        if (!spec.argv.includes('--profile') || !spec.argv.includes('native-acp-dsh-child')) return handle",
    '        const home = spec.env?.DSH_HOME',
    '        const record = { argv: spec.argv, cwd: spec.cwd, home, stdin: "", stdout: "", stderr: "",',
    '          inputPending: "", outputPending: "", childSessionId: null, childServerMetadata: null, childSessionMetadata: null,',
    '          childPermissionRequestIds: [], childPermissionRequests: [],',
    '          childPermissionResponses: [], childSessions: [], outcome: null, rangeEmpty: null, settled: false }',
    '        connections.push(record)',
    '        const captureSessions = () => { record.childSessions = readSessions(home, config.sessionFileName) }',
    '        const consume = (field, pending, chunk) => {',
    '          record[field] += chunk.toString("utf8")',
    '          record[pending] += chunk.toString("utf8")',
    '          let end',
    '          while ((end = record[pending].indexOf("\\n")) >= 0) {',
    '            const line = record[pending].slice(0, end).trim()',
    '            record[pending] = record[pending].slice(end + 1)',
    '            if (line === "") continue',
    '            let message',
    '            try { message = JSON.parse(line) } catch { continue }',
    '            if (field === "stdout" && message.method === "session/request_permission") {',
    '              record.childPermissionRequestIds.push(message.id)',
    '              record.childPermissionRequests.push(message.params)',
    '              captureSessions()',
    '            }',
    '            if (field === "stdout" && message.result?._meta?.["com.deepseek.ai/dsh-native-subagent"]?.capabilities) {',
    '              record.childServerMetadata = message.result._meta',
    '            }',
    '            if (field === "stdout" && message.result?.sessionId) {',
    '              record.childSessionId = message.result.sessionId',
    '              record.childSessionMetadata = message.result._meta',
    '            }',
    '            if (field === "stdin" && record.childPermissionRequestIds.includes(message.id)) {',
    '              record.childPermissionResponses.push({ id: message.id, result: message.result, error: message.error })',
    '            }',
    '          }',
    '          captureSessions()',
    '          persist()',
    '        }',
    '        const originalWrite = handle.stdin.write.bind(handle.stdin)',
    '        handle.stdin.write = function (chunk, ...args) {',
    '          consume("stdin", "inputPending", Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))',
    '          return originalWrite(chunk, ...args)',
    '        }',
    '        handle.stdout.on("data", chunk => consume("stdout", "outputPending", chunk))',
    '        handle.stderr.on("data", chunk => { record.stderr += chunk.toString("utf8"); persist() })',
    '        void handle.done.then(async outcome => {',
    '          record.outcome = outcome',
    '          captureSessions()',
    '          record.settled = true',
    '          persist()',
    '          try { record.rangeEmpty = await handle.waitForExit() }',
    '          catch (error) { record.rangeEmpty = String(error) }',
    '          captureSessions()',
    '          persist()',
    '        }, error => { record.outcome = String(error); record.settled = true; persist() })',
    '        return handle',
    '      }',
    '      context.own(() => { service.connect = originalConnect })',
    '    }',
    '  },',
    '}',
    '',
  ].join('\n'))
}

function modelResponse(response: import('node:http').ServerResponse, delta: JsonRecord, finishReason: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const events = [{ choices: [{ delta }] }, { choices: [{ delta: {}, finish_reason: finishReason }] }]
  response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
}

function launchCli(workspace: string, home: string) {
  return execa(process.execPath, [bin, '--profile', 'native-acp'], { cwd: workspace,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
      NATIVE_ACP_CHILD_FIXTURE_KEY: 'native-acp-child-loopback-key' },
    reject: false, timeout: 60_000, killSignal: 'SIGKILL' })
}

function tokenLimit(body: JsonRecord): { field: string; value: unknown } {
  const fields = ['max_tokens', 'max_completion_tokens', 'max_output_tokens']
    .filter(field => Object.hasOwn(body, field))
  if (fields.length !== 1) throw new Error(`model request has ${fields.length} output-token limit fields`)
  const field = fields[0]
  if (field === undefined) throw new Error('model request omitted output-token limit field')
  return { field, value: body[field] }
}

it('records a Native ACP parent delegating one approved write to its fixed ACP child', async () => {
  if (!existsSync(bin)) throw new Error('build the shipped dsh CLI before running the Native ACP external-child snapshot')
  const mode = process.env.DSH_SNAPSHOT
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  if (recorded === undefined && mode !== 'record') throw new Error('Native ACP external-child replay requires its committed Session JSONL')
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const replayTask = input?.type === 'user/message' ? textFromContent(input.data.content) : undefined
  if (recorded !== undefined && replayTask === undefined) throw new Error('Native ACP external-child Session omitted its user task')
  const delegated = recorded === undefined ? undefined : callArguments(recorded, 'subagent')
  const childTask = delegated?.prompt
  if (recorded !== undefined && typeof childTask !== 'string') throw new Error('Native ACP external-child Session omitted its delegated prompt')
  const oracleFile = join(scenario, 'workspace.expected', writePath)
  const fileContent = readFileSync(oracleFile, 'utf8')
  const requests: JsonRecord[] = []
  let parentCalls = 0
  let childCalls = 0
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      const body = JSON.parse(raw) as JsonRecord
      requests.push(body)
      const model = body.model
      if (model === parentModel) {
        parentCalls += 1
        if (parentCalls === 1) {
          modelResponse(response, { role: 'assistant', tool_calls: [{ index: 0,
            id: 'parent-delegate-call', type: 'function', function: { name: 'subagent', arguments: JSON.stringify({
              description: 'Write the approved snapshot file', prompt: typeof childTask === 'string' ? childTask
                : 'Write approved.txt with the exact workspace oracle contents, then report completion.',
            }) } }] }, 'tool_calls')
        } else {
          modelResponse(response, { role: 'assistant', content: parentReply }, 'stop')
        }
      } else if (model === childModel) {
        childCalls += 1
        if (childCalls === 1) {
          modelResponse(response, { role: 'assistant', tool_calls: [{ index: 0,
            id: 'child-approved-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({
              path: writePath, content: fileContent,
            }) } }] }, 'tool_calls')
        } else {
          modelResponse(response, { role: 'assistant', content: childReply }, 'stop')
        }
      } else {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: `unexpected fixture model ${String(model)}` }))
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Native ACP external-child snapshot has no model endpoint')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-acp-external-child-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const observationPath = join(home, 'child-observation.json')
  const profileDirectory = join(home, 'profiles', 'native-acp')
  const profilePath = join(profileDirectory, 'rsh.profile.json')
  let processRun: ReturnType<typeof launchCli> | undefined
  let transport: JsonRpcLineTransport | undefined
  const parentPermissionRequests: JsonRecord[] = []
  try {
    mkdirSync(workspace)
    ensureShippedNativeProfile('native-acp', home)
    const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
      installations: Array<{ id: string; plugin: string; scope: string; config?: JsonRecord; disabled?: boolean }>
    }
    const row = (id: string) => {
      const found = profile.installations.find(installation => installation.id === id)
      if (found === undefined) throw new Error(`shipped native-acp profile omitted ${id}`)
      return found
    }
    row('app').config = { ...row('app').config, provider: 'fixture', model: parentModel,
      systemPrompt: 'You are a helpful coding assistant.', maxSteps: 3, maxTokens: 64,
      builtinTools: true, allowedTools: ['read_file', 'write_file', 'subagent'], workspaceWriteRoot: workspace }
    row('storage').config = { root: sessions, compression: 'none' }
    row('subagents').config = { providerName: 'dsh-acp-child' }
    row('workflow-worker').config = { subagentProvider: 'dsh-acp-child' }
    row('ralph-tool').config = { ...row('ralph-tool').config, subagentProvider: 'dsh-acp-child' }
    row('subagent-tool').config = { toolName: 'subagent', maxDepth: 1, maxSteps: 2, maxTokens: 48,
      provider: 'fixture', model: childModel, toolFilter: { allow: ['write_file'] } }
    row('pi-ai').config = { providers: { fixture: { apiKeyEnv: 'NATIVE_ACP_CHILD_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: parentModel }, { id: childModel }] } } }
    profile.installations.push(
      { id: 'sandbox-policy', plugin: '@deepseek-ai/dsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'workspace-write', workspaceRoot: workspace } },
      { id: 'sandbox', plugin: '@deepseek-ai/dsh-sandbox-local', scope: 'root' },
      { id: 'acp-child', plugin: '@deepseek-ai/dsh-acp-child', scope: 'root', config: { providerName: 'dsh-acp-child', providers: {} } },
      { id: 'acp-child-observer', plugin: '@fixture/acp-child-observer', scope: 'root',
        config: { observationPath, sessionFileName: sessionFixtureName(0, SESSION_FORMAT_VERSION) } },
    )
    installChildObserver(profileDirectory)
    writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)

    const launched = launchCli(workspace, home)
    processRun = launched
    transport = new JsonRpcLineTransport(launched.stdout, launched.stdin)
    transport.onRequest(async (method, params) => {
      if (method !== 'session/request_permission') throw new Error(`unexpected parent ACP request ${method}`)
      const request = params as JsonRecord
      parentPermissionRequests.push(request)
      expect(request.options).toEqual([
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ])
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })
    transport.start()
    const signal = AbortSignal.timeout(45_000)
    const initialized = await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {},
      _meta: { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: { version: 1, permissionRelay: true } } }, signal)
    expect(initialized).toMatchObject({ protocolVersion: 1 })
    const policy = { version: 1, maxSteps: 3, maxTokens: 64, permissionMode: 'parent-relay' }
    const created = await transport.request('session/new', { cwd: workspace, mcpServers: [],
      _meta: { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: policy } }, signal) as { sessionId: string; _meta?: JsonRecord }
    expect(created._meta).toEqual({ [NATIVE_ACP_SUBAGENT_METADATA_KEY]: policy })
    const response = await transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: replayTask ?? initialTask }] }, signal) as JsonRecord
    expect(response).toMatchObject({ stopReason: 'end_turn' })
    expect(parentPermissionRequests).toHaveLength(1)
    await transport.request('session/close', { sessionId: created.sessionId }, signal)
    launched.stdin.end()
    const exited = await launched
    transport.close()
    transport = undefined
    expect(exited.exitCode, exited.stderr).toBe(0)

    const logPaths = readdirSync(sessions, { recursive: true }).filter(path => String(path).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
    expect(logPaths).toHaveLength(1)
    const parentRaw = readFileSync(join(sessions, String(logPaths[0])), 'utf8')
    const parentEvents = parseSessionLog(parentRaw)
    const parentHeader = JSON.parse(parentRaw.split(/\r?\n/u)[0] ?? '{}') as { id?: unknown }
    if (typeof parentHeader.id !== 'string') throw new Error('Native ACP parent Session omitted its durable identity')
    const parentAsk = parentEvents.filter(event => event.type === 'native-approval/asked')
    const parentDecision = parentEvents.filter(event => event.type === 'native-approval/decided')
    const parentAskEvent = parentAsk[0]
    if (parentAskEvent?.type !== 'native-approval/asked') throw new Error('Native ACP parent Session omitted its durable approval request')
    const parentWire = parentPermissionRequests[0]
    if (parentWire === undefined) throw new Error('Native ACP parent permission request was not captured')
    const parentIdentity = readNativeAcpSubagentPermissionRequest(parentWire._meta)
    if (parentIdentity === undefined) throw new Error('Native ACP parent permission request omitted native identity')
    expect(parentWire.sessionId).toBe(created.sessionId)
    expect(parentIdentity.sessionId).toBe(parentHeader.id)
    expect(parentWire.toolCall).toMatchObject({ toolCallId: parentIdentity.toolCallId })
    expect(parentIdentity).toMatchObject({ toolName: 'write_file' })
    expect(parentAsk.map(event => ({ id: String(event.data.id), callId: String(event.data.callId) })))
      .toEqual([{ id: parentIdentity.requestId, callId: parentIdentity.toolCallId }])
    expect(parentDecision).toHaveLength(1)
    expect(parentDecision).toMatchObject([{ data: { id: parentIdentity.requestId, outcome: 'allowed-once' } }])

    if (!existsSync(observationPath)) throw new Error('Native ACP fixed child observer did not publish its process record')
    const observation = JSON.parse(readFileSync(observationPath, 'utf8')) as {
      connections: Array<{ argv: string[]; cwd: string; home: string; stdin: string; stdout: string; stderr: string;
        childSessionId: string | null; childServerMetadata: unknown; childSessionMetadata: unknown;
        childPermissionRequestIds: unknown[]; childPermissionRequests: JsonRecord[];
        childPermissionResponses: JsonRecord[];
        childSessions: Array<{ raw: string }>; outcome: unknown; rangeEmpty: unknown; settled: boolean }>
    }
    expect(observation.connections).toHaveLength(1)
    const child = observation.connections[0]
    if (child === undefined) throw new Error('Native ACP fixed child process record is missing')
    expect(child.argv).toEqual(expect.arrayContaining(['--profile', 'native-acp-dsh-child', '--patch']))
    expect(child.cwd).toBe(workspace)
    expect(child.outcome).toMatchObject({ exitCode: 0, signal: null })
    expect(child.rangeEmpty).toBe(true)
    expect(child.settled).toBe(true)
    expect(existsSync(child.home)).toBe(false)
    expect(child.childPermissionRequests).toHaveLength(1)
    expect(child.childPermissionResponses).toHaveLength(1)
    expect(child.childPermissionRequestIds).toHaveLength(1)
    expect(child.childSessions).toHaveLength(1)
    expect(readNativeAcpSubagentServerCapabilities(child.childServerMetadata)).toEqual({
      permissionRequestIdentity: true, maxSteps: true, maxTokens: true, permissionModes: ['deny', 'parent-relay'],
    })
    expect(readNativeAcpSubagentPolicy(child.childSessionMetadata)).toEqual({
      version: 1, maxSteps: 2, maxTokens: 48, permissionMode: 'parent-relay',
    })
    const childPermissionRpcId = child.childPermissionRequestIds[0]
    if (childPermissionRpcId === undefined) throw new Error('Native ACP child permission request omitted its JSON-RPC id')
    expect(child.childPermissionResponses[0]).toMatchObject({ id: childPermissionRpcId,
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } })
    const childSessionRaw = child.childSessions[0]?.raw
    if (childSessionRaw === undefined) throw new Error('Native ACP child approval Session was not captured before cleanup')
    const childEvents = parseSessionLog(childSessionRaw)
    const childHeader = JSON.parse(childSessionRaw.split(/\r?\n/u)[0] ?? '{}') as { id?: unknown }
    if (typeof childHeader.id !== 'string' || child.childSessionId === null) {
      throw new Error('Native ACP child Session identity was not captured')
    }
    const childWire = child.childPermissionRequests[0]
    if (childWire === undefined) throw new Error('Native ACP child permission request is missing')
    const childIdentity = readNativeAcpSubagentPermissionRequest(childWire._meta)
    if (childIdentity === undefined) throw new Error('Native ACP child permission request omitted native identity')
    const parentReason = parentAskEvent.data.reason
    if (typeof parentReason !== 'string') throw new Error('Native ACP parent approval omitted its reason')
    expect(parentReason).toContain(childIdentity.requestId)
    expect(parentReason.split(childIdentity.requestId)).toHaveLength(2)
    expect(childWire.sessionId).toBe(child.childSessionId)
    expect(childIdentity.sessionId).toBe(childHeader.id)
    expect(childWire.toolCall).toMatchObject({ toolCallId: childIdentity.toolCallId })
    expect(childIdentity.toolName).toBe('write_file')
    const childAsk = childEvents.filter(event => event.type === 'native-approval/asked')
    const childDecision = childEvents.filter(event => event.type === 'native-approval/decided')
    const childWrite = childEvents.find(event => event.type === 'tool/call' && event.data.name === 'write_file')
    expect(childAsk.map(event => ({ id: String(event.data.id), callId: String(event.data.callId) })))
      .toEqual([{ id: childIdentity.requestId, callId: childIdentity.toolCallId }])
    expect(childDecision).toHaveLength(1)
    expect(childDecision).toMatchObject([{ data: { id: childIdentity.requestId, outcome: 'allowed-once' } }])
    if (childWrite?.type !== 'tool/call') throw new Error('Native ACP child did not persist the approved write call')
    expect(callArguments(childEvents, 'write_file')).toMatchObject({ path: writePath, content: fileContent })
    expect(childEvents.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(childEvents.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })

    const starts = parentEvents.filter(event => event.type === 'subagent/external-start')
    const ends = parentEvents.filter(event => event.type === 'subagent/external-end')
    const externalFacts = parentEvents.filter(event => event.type === 'subagent/external-operation')
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(externalFacts).toHaveLength(0)
    if (starts[0]?.type !== 'subagent/external-start' || ends[0]?.type !== 'subagent/external-end') {
      throw new Error('Native ACP parent Session omitted external child lifecycle')
    }
    expect(ends[0].data).toMatchObject({ id: starts[0].data.id, provider: 'dsh-acp-child', stopReason: 'completed' })
    const parentTool = parentEvents.find(event => event.type === 'tool/call' && event.data.name === 'subagent')
    const parentResult = parentEvents.find(event => event.type === 'tool/result'
      && parentTool?.type === 'tool/call' && event.data.message.source.callId === parentTool.data.callId)
    if (parentTool?.type !== 'tool/call' || parentResult?.type !== 'tool/result') {
      throw new Error('Native ACP parent Session omitted the delegation tool result')
    }
    expect(callArguments(parentEvents, 'subagent')).toMatchObject({ prompt: typeof childTask === 'string' ? childTask : expect.any(String) })
    expect(parentTool.seq).toBeLessThan(starts[0].seq)
    expect(starts[0].seq).toBeLessThan(ends[0].seq)
    expect(ends[0].seq).toBeLessThan(parentResult.seq)
    expect(parentEvents.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests.map(request => request.model)).toEqual([parentModel, childModel, childModel, parentModel])
    expect(requests.map(request => tokenLimit(request))).toEqual([
      { field: expect.any(String), value: 64 }, { field: expect.any(String), value: 48 },
      { field: expect.any(String), value: 48 }, { field: expect.any(String), value: 64 },
    ])

    const policyEvents = parentEvents.filter(event => event.type === 'execution/policy')
    expect(policyEvents).toHaveLength(1)
    expect(policyEvents).toMatchObject([{ data: { version: 1, maxSteps: 3, maxTokens: 64,
      permission: { mode: 'require-approval', authority: 'session-owner' } } }])
    const childPolicyEvents = childEvents.filter(event => event.type === 'execution/policy')
    expect(childPolicyEvents).toHaveLength(1)
    expect(childPolicyEvents)
      .toMatchObject([{ data: { version: 1, maxSteps: 2, maxTokens: 48,
        permission: { mode: 'require-approval', authority: 'session-owner' } } }])
    expect(await captureWorkspaceSnapshot(workspace)).toEqual(await captureExpectedWorkspaceSnapshot(join(scenario, 'workspace.expected')))

    const context = { cwd: workspace, sessionIds: [parentHeader.id] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([parentRaw])[0] ?? parentRaw, context,
      { identityMode: 'preserve' }).replaceAll(childIdentity.requestId, '{{child-approval}}')
    const prompts = normalizedSystemPrompts(parentRaw, context)
    const schemas = normalizedToolSchemas(parentRaw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('Native ACP parent Session omitted model request headers')
    const promptSnapshot = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const schemaSnapshot = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    const stableRequests = JSON.stringify(requests.map(request => workspaceValues({ model: request.model,
      ...tokenLimit(request), messages: request.messages, tools: request.tools ?? [] }, workspace)), null, 2) + '\n'
    const protocolSnapshot = JSON.stringify({ parentPermission: {
      recipientSession: '{{parent-acp-session}}', nativeSession: '{{parent-native-session}}',
      requestId: '{{parent-approval}}', toolName: parentIdentity.toolName, toolCallId: parentIdentity.toolCallId, outcome: 'allow-once',
    }, childPermission: {
      recipientSession: '{{child-acp-session}}', nativeSession: '{{child-native-session}}',
      requestId: '{{child-approval}}', toolName: childIdentity.toolName, toolCallId: childIdentity.toolCallId, outcome: 'allow-once',
    }, process: { profile: 'native-acp-dsh-child', exitCode: 0, rangeEmpty: true, settled: true },
    externalOperationFacts: 0 }, null, 2) + '\n'
    const expected = {
      [sessionFixtureName(0, SESSION_FORMAT_VERSION)]: normalized,
      'protocol.expected.json': protocolSnapshot,
      'model-request.expected.json': stableRequests,
      'system-prompt.expected.md': promptSnapshot,
      'tool-schemas.expected.json': schemaSnapshot,
    }
    if (mode === 'record' || mode === 'refresh') {
      for (const [name, contents] of Object.entries(expected)) writeFileSync(join(scenario, name), contents)
    } else {
      for (const [name, contents] of Object.entries(expected)) expect(contents).toBe(readFileSync(join(scenario, name), 'utf8'))
    }
  } catch (error) {
    if (processRun !== undefined) {
      const outcome = await processRun
      throw new Error(`Native ACP parent exited ${outcome.exitCode}: ${outcome.stderr}`, { cause: error })
    }
    throw error
  } finally {
    if (transport !== undefined) transport.close()
    if (processRun !== undefined) {
      processRun.kill('SIGKILL')
      await processRun.catch(() => undefined)
    }
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
})
