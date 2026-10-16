/** Packed-consumer coverage for scheduled reminders across a cold SDK restore. */
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const PACKED_BIN = process.env.DSH_PACKED_DSH_BIN
const CONSUMER_ROOT = process.env.DSH_PACKED_CONSUMER_ROOT
const SESSION_ID = 'packed-native-scheduled-reminder'
const FIRST_TASK = 'Create the scheduled reminder from the tool fixture.'
const COLD_TASK = 'Continue this session after restart.'
const REMINDER_PROMPT = 'PACKED_SCHEDULED_REMINDER_PROMPT_6b31c8'
const TOOL_CALL_ID = 'create-packed-scheduled-reminder'
const MODEL = 'packed-scheduled-reminder-fixture'
const FIRST_REPLY = 'scheduled reminder created'
const COLD_REPLY = 'cold scheduled reminder restored'

type JsonObject = Record<string, unknown>
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
  response.write('data: ' + JSON.stringify(value) + '\n\n')
}

function respondWithText(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function respondWithScheduleCreate(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: TOOL_CALL_ID, type: 'function',
    function: { name: 'schedule_create', arguments: JSON.stringify({ prompt: REMINDER_PROMPT, after_seconds: 45 }) } }] },
  finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function requestLastUserText(request: JsonObject): string {
  if (!Array.isArray(request.messages)) return ''
  const last: unknown = request.messages.filter(message => isRecord(message) && message.role === 'user').at(-1)
  if (!isRecord(last)) return ''
  if (typeof last.content === 'string') return last.content
  if (!Array.isArray(last.content)) return ''
  return last.content.filter(isRecord).filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string).join('\n')
}

function isScheduleReminder(event: JsonObject): boolean {
  return event.type === 'user/message' && isRecord(event.data)
    && isRecord(event.data.source) && event.data.source.kind === 'plugin' && event.data.source.plugin === 'schedule'
    && Array.isArray(event.data.content) && event.data.content.some(block => isRecord(block)
      && typeof block.text === 'string' && block.text.includes(REMINDER_PROMPT))
}

async function readSessionEvents(root: string, sessionId: string): Promise<JsonObject[]> {
  let current: { readonly version: number; readonly events: JsonObject[] } | undefined
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const [header, ...events] = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean)
        .map(line => JSON.parse(line) as unknown)
      if (!isRecord(header) || header.type !== 'session' || header.id !== sessionId) continue
      if (typeof header.version !== 'number' || events.some(event => !isRecord(event))) {
        throw new Error(`packed-scheduled-reminder: invalid Session JSONL in ${path}`)
      }
      if (current === undefined || header.version > current.version) {
        current = { version: header.version, events: events as JsonObject[] }
      }
    }
  }
  await visit(root)
  if (current === undefined) throw new Error(`packed-scheduled-reminder: Session ${sessionId} was not persisted`)
  return current.events
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
  'dispatches a scheduled reminder after restoring a packed SDK Session',
  async () => {
    const consumerRoot = CONSUMER_ROOT
    const packedBin = PACKED_BIN
    if (consumerRoot === undefined || packedBin === undefined) throw new Error('packed consumer variables are missing')
    const installedRoot = await realpath(consumerRoot)
    const installedBin = await realpath(packedBin)
    const binRelative = relative(installedRoot, installedBin)
    expect(binRelative.startsWith('..' + sep) || isAbsolute(binRelative)).toBe(false)
    expect(binRelative.split(sep)).toEqual(['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'])
    const consumerRequire = createRequire(join(installedRoot, 'package.json'))
    const sdkClientPath = await realpath(consumerRequire.resolve('@deepseek-ai/dsh-sdk-client'))
    const sdkRelative = relative(installedRoot, sdkClientPath)
    expect(sdkRelative.startsWith('..' + sep) || isAbsolute(sdkRelative)).toBe(false)
    expect(sdkRelative.split(sep).slice(0, 3)).toEqual(['node_modules', '@deepseek-ai', 'dsh-sdk-client'])
    for (const packageName of ['@deepseek-ai/dsh-task-scheduler', '@deepseek-ai/dsh-schedule']) {
      const packagePath = await realpath(consumerRequire.resolve(packageName + '/package.json'))
      const packageRelative = relative(installedRoot, packagePath)
      expect(packageRelative.startsWith('..' + sep) || isAbsolute(packageRelative)).toBe(false)
    }
    const { DeepSeekHarness } = await import(pathToFileURL(sdkClientPath).href) as InstalledSdk

    const root = await mkdtemp(join(installedRoot, '.dsh-p4-scheduled-reminder-'))
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    const sessionsRoot = join(home, 'sessions')
    const patch = join(root, 'schedule.patch.json')
    let server: ReturnType<typeof createServer> | undefined
    try {
      await mkdir(workspace, { recursive: true })
      const childEnv: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
        PACKED_SCHEDULE_FIXTURE_KEY: 'packed-local-fixture-key' }
      delete childEnv.NODE_OPTIONS
      delete childEnv.NODE_PATH
      delete childEnv.DEEPSEEK_BASE_URL
      const profileDump = await execa(process.execPath, [installedBin, '--profile', 'native-sdk', '--dump-config'], {
        cwd: workspace, env: childEnv, extendEnv: false, reject: false, timeout: 30_000,
      })
      expect(profileDump.timedOut, profileDump.stderr).toBe(false)
      expect(profileDump.exitCode, profileDump.stderr).toBe(0)
      const profileConfig = join(home, 'profiles', 'native-sdk', 'rsh.profile.json')
      const composition = JSON.parse(await readFile(profileConfig, 'utf8')) as { installations: JsonObject[] }
      composition.installations.push(
        { id: 'task-scheduler', plugin: '@deepseek-ai/dsh-task-scheduler', scope: 'root',
          config: { path: join(home, 'profiles', 'native-sdk', 'task-scheduler.sqlite') } },
        { id: 'schedule', plugin: '@deepseek-ai/dsh-schedule', scope: 'root' },
      )
      await writeFile(profileConfig, JSON.stringify(composition))

      const requests: JsonObject[] = []
      const modelServer = createServer((request: IncomingMessage, response: ServerResponse) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
          if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            response.writeHead(404).end()
            return
          }
          const parsed = JSON.parse(body) as unknown
          if (!isRecord(parsed)) {
            response.writeHead(400).end()
            return
          }
          requests.push(parsed)
          if (requests.length === 1) respondWithScheduleCreate(response)
          else respondWithText(response, requests.length === 2 ? FIRST_REPLY : COLD_REPLY)
        })
      })
      server = modelServer
      await new Promise<void>((resolve, reject) => {
        modelServer.once('error', reject)
        modelServer.listen(0, '127.0.0.1', () => { modelServer.removeListener('error', reject); resolve() })
      })
      const address = modelServer.address()
      if (address === null || typeof address === 'string') throw new Error('packed-scheduled-reminder: model fixture did not bind')
      const baseURL = `http://127.0.0.1:${address.port}/v1`
      await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { systemPrompt: 'You are a scheduled reminder fixture.', maxSteps: 3 } },
        { id: 'storage', config: { root: sessionsRoot, compression: 'none' } },
        { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'PACKED_SCHEDULE_FIXTURE_KEY', api: 'openai-completions',
          baseURL, models: [{ id: MODEL }] } } } },
      ] }))

      const options = { profile: 'native-sdk' as const, dshBin: installedBin, dshHome: home, patches: [patch],
        cwd: workspace, provider: 'fixture' as const, model: MODEL, env: childEnv, requestTimeoutMs: 20_000 }
      const firstHarness = new DeepSeekHarness(options)
      let first: RunResult
      try { first = await firstHarness.session(SESSION_ID).run(FIRST_TASK) }
      finally { await firstHarness.close() }

      expect(JSON.stringify(requests[0]?.tools)).toContain('"name":"schedule_create"')
      expect(first.finalResponse).toBe(FIRST_REPLY)
      expect(first.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      const createEvent = first.events.find(event => event.type === 'schedule/change' && isRecord(event.data)
        && event.data.operation === 'create' && isRecord(event.data.schedule))
      if (createEvent === undefined || !isRecord(createEvent.data) || !isRecord(createEvent.data.schedule)
        || typeof createEvent.data.schedule.id !== 'string' || typeof createEvent.data.schedule.scheduledAt !== 'string') {
        throw new Error('packed-scheduled-reminder: created schedule was not persisted')
      }
      const scheduleId = createEvent.data.schedule.id
      const dueInMs = Date.parse(createEvent.data.schedule.scheduledAt) - Date.now()
      expect(dueInMs, 'first SDK Host must close before the reminder is due').toBeGreaterThan(0)
      await new Promise<void>(resolve => setTimeout(resolve, dueInMs + 200))

      const requestsBeforeRestore = requests.length
      const coldHarness = new DeepSeekHarness(options)
      let recovery: RunResult
      try {
        recovery = await coldHarness.session(SESSION_ID).run(COLD_TASK)
        await new Promise<void>(resolve => setTimeout(resolve, 3_000))
      }
      finally { await coldHarness.close() }

      const recoveryDispatches = recovery.events.filter(event => event.type === 'schedule/change' && isRecord(event.data)
        && event.data.operation === 'dispatch' && event.data.id === scheduleId)
      expect(recoveryDispatches.length).toBe(1)
      const recoveryReminders = recovery.events.filter(isScheduleReminder)
      expect(recoveryReminders.length).toBe(1)

      const reminderRequests = requests.slice(requestsBeforeRestore)
        .filter(request => requestLastUserText(request).includes(REMINDER_PROMPT))
      expect(reminderRequests.length).toBe(1)

      const durableEvents = await readSessionEvents(sessionsRoot, SESSION_ID)
      const durableDispatches = durableEvents.filter(event => event.type === 'schedule/change' && isRecord(event.data)
        && event.data.operation === 'dispatch' && event.data.id === scheduleId)
      expect(durableDispatches.length).toBe(1)
      const durableReminders = durableEvents.filter(isScheduleReminder)
      expect(durableReminders.length).toBe(1)
      const runReminderId = isRecord(recoveryReminders[0]!.data) ? recoveryReminders[0]!.data.id : undefined
      const durableReminderId = isRecord(durableReminders[0]!.data) ? durableReminders[0]!.data.id : undefined
      expect(runReminderId).toEqual(expect.any(String))
      expect(durableReminderId).toBe(runReminderId)
    } finally {
      try { if (server !== undefined) await closeServer(server) }
      finally { await rm(root, { recursive: true, force: true }) }
    }
  },
  180_000,
)
