/** Packed-consumer coverage for Skills loading and cold Session recovery. */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const PACKED_BIN = process.env.DSH_PACKED_DSH_BIN
const CONSUMER_ROOT = process.env.DSH_PACKED_CONSUMER_ROOT
const SESSION_ID = 'packed-native-skills'
const FIRST_TASK = '/review Apply the review skill to the requested change, then summarize its instruction.'
const COLD_TASK = '/review Continue after restart and follow the review skill again.'
const SKILL_BODY = 'Always inspect the requested file before proposing a fix. Use the skill tool to load these instructions when relevant.'
const TOOL_CALL_ID = 'load-review-skill'
const MODEL = 'packed-skills-fixture'
const LOADED_REPLY = 'loaded review instructions'
const COLD_REPLY = 'cold skill Session restored'

type JsonObject = Record<string, unknown>
type PersistedSession = { readonly header: JsonObject; readonly events: readonly JsonObject[] }
type RunResult = { readonly sessionId: string; readonly finalResponse: string; readonly events: JsonObject[] }
type InstalledSdk = {
  DeepSeekHarness: new (options: {
    readonly profile: 'native-sdk'
    readonly dshBin: string
    readonly dshHome: string
    readonly patches: string[]
    readonly cwd: string
    readonly provider: 'fixture'
    readonly model: string
    readonly env: NodeJS.ProcessEnv
    readonly requestTimeoutMs: number
  }) => {
    session(sessionId: string): { run(input: string): Promise<RunResult> }
    close(): Promise<void>
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`)
}

function respondWithText(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function respondWithSkillCall(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: TOOL_CALL_ID, type: 'function',
    function: { name: 'skill', arguments: JSON.stringify({ name: 'review' }) } }] }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

async function readSessions(root: string): Promise<PersistedSession[]> {
  const sessions: PersistedSession[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const rows = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean)
        .map(line => JSON.parse(line) as unknown)
      const [header, ...events] = rows
      if (!isRecord(header) || header.type !== 'session' || events.some(event => !isRecord(event))) {
        throw new Error(`packed-skills: invalid Session JSONL in ${path}`)
      }
      sessions.push({ header, events: events as JsonObject[] })
    }
  }
  await visit(root)
  return sessions
}

function toolResult(events: readonly JsonObject[]): JsonObject {
  const event = events.find(candidate => candidate.type === 'tool/result' && isRecord(candidate.data)
    && isRecord(candidate.data.message) && isRecord(candidate.data.message.source)
    && candidate.data.message.source.callId === TOOL_CALL_ID)
  if (event === undefined || !isRecord(event.data) || !isRecord(event.data.message)
    || !Array.isArray(event.data.message.content)) throw new Error('packed-skills: Skill result was not persisted')
  const result = (event.data.message.content as unknown[]).find(block => isRecord(block)
    && block.type === 'tool-result' && block.toolCallId === TOOL_CALL_ID)
  if (!isRecord(result)) throw new Error('packed-skills: Skill result block is missing')
  return result
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

it.skipIf(PACKED_BIN === undefined || CONSUMER_ROOT === undefined)(
  'runs Skills through the packed SDK client and dsh consumer, then cold-reads the same Session',
  async () => {
    const consumerRoot = CONSUMER_ROOT
    const packedBin = PACKED_BIN
    if (consumerRoot === undefined || packedBin === undefined) throw new Error('packed consumer variables are missing')
    const installedRoot = await realpath(consumerRoot)
    const installedBin = await realpath(packedBin)
    const binRelative = relative(installedRoot, installedBin)
    expect(binRelative.startsWith(`..${sep}`) || isAbsolute(binRelative)).toBe(false)
    expect(binRelative.split(sep)).toEqual(['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'])
    const consumerRequire = createRequire(join(installedRoot, 'package.json'))
    const sdkClientPath = await realpath(consumerRequire.resolve('@deepseek-ai/dsh-sdk-client'))
    await writeFile(join(installedRoot, 'sdk-consumer.ts'), [
      "import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'",
      "const client = new DeepSeekHarness({ profile: 'sdk' })",
      'void client',
      '',
    ].join('\n'))
    const consumerConfig = join(installedRoot, 'tsconfig.json')
    await writeFile(consumerConfig, JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      skipLibCheck: false, types: [], noEmit: true,
    }, files: ['sdk-consumer.ts'] }))
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
    const typecheck = execFileSync(process.execPath, [tsc, '-p', consumerConfig, '--noEmit', '--listFiles'], {
      cwd: installedRoot, encoding: 'utf8', stdio: 'pipe',
    })
    expect(typecheck).not.toMatch(/node_modules[\\/]@deepseek-ai[\\/]cordis(?:[\\/]|$)/iu)
    const sdkRelative = relative(installedRoot, sdkClientPath)
    expect(sdkRelative.startsWith(`..${sep}`) || isAbsolute(sdkRelative)).toBe(false)
    expect(sdkRelative.split(sep).slice(0, 3)).toEqual(['node_modules', '@deepseek-ai', 'dsh-sdk-client'])
    const { DeepSeekHarness } = await import(pathToFileURL(sdkClientPath).href) as InstalledSdk

    const root = await mkdtemp(join(installedRoot, '.dsh-p4-skills-'))
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    const sessionsRoot = join(home, 'sessions')
    const patch = join(root, 'skills.patch.json')
    let server: ReturnType<typeof createServer> | undefined
    try {
      await mkdir(join(workspace, '.agents', 'skills', 'review'), { recursive: true })
      const skillFile = join(workspace, '.agents', 'skills', 'review', 'SKILL.md')
      await writeFile(skillFile, [
        '---', 'name: review', 'description: Inspect changes and state concrete findings.', '---', '', SKILL_BODY, '',
      ].join('\n'))
      const requests: JsonObject[] = []
      const unexpectedRequests: string[] = []
      const modelServer = createServer((request: IncomingMessage, response: ServerResponse) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
          if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            unexpectedRequests.push(`${request.method ?? '<no method>'} ${request.url ?? '<no path>'}`)
            response.writeHead(404).end()
            return
          }
          let parsed: unknown
          try { parsed = JSON.parse(body) as unknown }
          catch {
            unexpectedRequests.push('model request body was not JSON')
            response.writeHead(400).end()
            return
          }
          if (!isRecord(parsed)) {
            unexpectedRequests.push('model request body was not an object')
            response.writeHead(400).end()
            return
          }
          requests.push(parsed)
          const messages = JSON.stringify(parsed.messages) ?? ''
          const hasSkillToolMessage = Array.isArray(parsed.messages) && parsed.messages.some(message =>
            isRecord(message) && message.role === 'tool' && message.tool_call_id === TOOL_CALL_ID)
          if (requests.length === 1 && messages.includes(FIRST_TASK)) respondWithSkillCall(response)
          else if (requests.length === 2 && hasSkillToolMessage) respondWithText(response, LOADED_REPLY)
          else if (requests.length === 3 && messages.includes(COLD_TASK)) respondWithText(response, COLD_REPLY)
          else {
            unexpectedRequests.push(`unexpected model request ${String(requests.length)}: ${messages.slice(-300)}`)
            response.writeHead(500).end()
          }
        })
      })
      server = modelServer
      await new Promise<void>((resolve, reject) => {
        modelServer.once('error', reject)
        modelServer.listen(0, '127.0.0.1', () => { modelServer.removeListener('error', reject); resolve() })
      })
      const address = modelServer.address()
      if (address === null || typeof address === 'string') throw new Error('packed-skills: model fixture did not bind')
      const baseURL = `http://127.0.0.1:${address.port}/v1`
      await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { systemPrompt: 'You are a Native Skills fixture.', maxSteps: 3 } },
        { id: 'storage', config: { root: sessionsRoot, compression: 'none' } },
        { id: 'fs', config: { cwd: workspace } },
        { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'PACKED_SKILLS_FIXTURE_KEY', api: 'openai-completions',
          baseURL, models: [{ id: MODEL }] } } } },
      ] }))

      const childEnv: NodeJS.ProcessEnv = { ...process.env, DSH_TELEMETRY_DISABLED: '1',
        PACKED_SKILLS_FIXTURE_KEY: 'packed-local-fixture-key' }
      delete childEnv.NODE_OPTIONS
      delete childEnv.NODE_PATH
      delete childEnv.DEEPSEEK_BASE_URL
      execFileSync(process.execPath, [installedBin, '--profile', 'native-sdk', '--dump-config'],
        { cwd: workspace, env: { ...childEnv, DSH_HOME: home }, stdio: 'ignore' })
      const profileConfig = join(home, 'profiles', 'native-sdk', 'rsh.profile.json')
      const composition = JSON.parse(await readFile(profileConfig, 'utf8')) as { installations: JsonObject[] }
      composition.installations.push(
        { id: 'request-context', plugin: '@deepseek-ai/dsh-request-context', scope: 'root' },
        { id: 'skills', plugin: '@deepseek-ai/dsh-skill', scope: 'root' },
        { id: 'skill-filesystem', plugin: '@deepseek-ai/dsh-skill-filesystem', scope: 'root',
          config: { agentsHome: home, dshHome: home, watch: false } },
        { id: 'tool-skill', plugin: '@deepseek-ai/dsh-tool-skill', scope: 'root' },
      )
      await writeFile(profileConfig, JSON.stringify(composition))
      const options = { profile: 'native-sdk' as const, dshBin: installedBin, dshHome: home, patches: [patch],
        cwd: workspace, provider: 'fixture' as const, model: MODEL, env: childEnv, requestTimeoutMs: 20_000 }
      const firstHarness = new DeepSeekHarness(options)
      let first: RunResult
      try { first = await firstHarness.session(SESSION_ID).run(FIRST_TASK) }
      finally { await firstHarness.close() }
      const coldHarness = new DeepSeekHarness(options)
      let recovery: RunResult
      try { recovery = await coldHarness.session(SESSION_ID).run(COLD_TASK) }
      finally { await coldHarness.close() }

      expect(first.sessionId).toBe(SESSION_ID)
      expect(recovery.sessionId).toBe(SESSION_ID)
      expect(first.finalResponse).toBe(LOADED_REPLY)
      expect(recovery.finalResponse).toBe(COLD_REPLY)
      expect(first.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(recovery.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(unexpectedRequests).toEqual([])
      expect(requests).toHaveLength(3)
      expect(requests.some(request => (JSON.stringify(request.messages) ?? '').includes(SKILL_BODY))).toBe(true)
      expect(JSON.stringify(requests[0]?.tools)).toContain('"name":"skill"')
      expect(JSON.stringify(requests[2]?.messages)).toContain(COLD_TASK)
      expect(JSON.stringify(requests[2]?.messages)).toContain(SKILL_BODY)
      expect(JSON.stringify(requests[2]?.messages)).toContain(TOOL_CALL_ID)
      expect(recovery.events.some(event => event.type === 'tool/call')).toBe(false)

      const firstToolResult = toolResult(first.events)
      const persisted = (await readSessions(sessionsRoot)).filter(session => session.header.id === SESSION_ID)
      expect(persisted).toHaveLength(1)
      const persistedToolResult = toolResult(persisted[0]!.events)
      expect(firstToolResult).toEqual(persistedToolResult)
      expect(firstToolResult).toMatchObject({ toolCallId: TOOL_CALL_ID, isError: false })
      const canonicalEvents = (await readFile(new URL('../../../../../../../snapshots/native-sdk/skills/session.v3.jsonl', import.meta.url), 'utf8'))
        .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as JsonObject).slice(1)
      const canonicalContent = toolResult(canonicalEvents).content as JsonObject[]
      const expectedContent = canonicalContent.map(block => ({
        ...block,
        text: (block.text as string).replace('{{cwd}}/.agents/skills/review', join(workspace, '.agents', 'skills', 'review')),
      }))
      expect(firstToolResult.content).toEqual(expectedContent)
      const expectedText = expectedContent.map(block => block.text).join('\n')
      for (const request of requests.slice(1)) {
        const toolMessages = (request.messages as unknown[]).filter(message => isRecord(message)
          && message.role === 'tool' && message.tool_call_id === TOOL_CALL_ID)
        expect(toolMessages).toEqual([expect.objectContaining({ content: expectedText })])
      }
      expect(JSON.stringify(first.events)).toContain(SKILL_BODY)
    } finally {
      try { if (server !== undefined) await closeServer(server) }
      finally { await rm(root, { recursive: true, force: true }) }
    }
  },
)
