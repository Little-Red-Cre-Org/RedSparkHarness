/** Workspace instructions remain durable and nonduplicated through a cold SDK process restore. */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execa } from 'execa'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { DeepSeekHarness, type HarnessNotification, type RunResult } from '@deepseek-ai/dsh-sdk-client'
import type { ScheduleId } from '@deepseek-ai/dsh-schedule/client'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds,
} from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-sdk/scheduled-root-origin')
const fixture = join(scenario, 'session.v3.jsonl')
const sessionId = 'sdk-scheduled-root-origin'
const workspaceInstruction = 'SDK_WORKSPACE_INSTRUCTIONS_51d2c8'
const globalInstruction = 'SDK_PARENT_GLOBAL_INSTRUCTIONS_51d2c8'
const firstPrompt = 'Use the workspace instructions for this first turn.'
const prompt = 'Report the result of this restored scheduled root.'
const finalResponse = 'The restored scheduled root completed with workspace guidance through the native SDK.'
const scheduleId = 'sdk-scheduled-origin-reminder' as ScheduleId
const schedulePrompt = 'Review the retained workspace guidance after this SDK session resumes.'

interface ModelRequest extends Record<string, unknown> {
  readonly messages?: readonly { readonly role: string; readonly content: unknown }[]
  readonly tools?: readonly { readonly function?: { readonly name?: string } }[]
}

function requestText(messages: ModelRequest['messages']): string {
  return (messages ?? []).filter(message => message.role === 'user').flatMap(message => {
    if (typeof message.content === 'string') return [message.content]
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap(block => typeof block === 'object' && block !== null
      && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : [])
  }).join('\n')
}

interface OriginOwner {
  readonly sessionId: string
  readonly invocation: string
  readonly rootOrigin: string | null
  readonly taskScheduleToolVisible: boolean
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function sse(text: string): string {
  return [
    { choices: [{ delta: { role: 'assistant', content: text } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
}

async function waitFor<T>(stage: string, operation: Promise<T>, report: () => unknown): Promise<T> {
  const timeout = deadline(undefined, 15_000, 'NATIVE_SDK_SCHEDULED_ORIGIN')
  const expired = new Promise<never>((_resolve, reject) => {
    const abort = (): void => reject(new Error(`native SDK scheduled-origin: ${stage} deadline; ${JSON.stringify(report())}`,
      { cause: timeout.signal.reason }))
    if (timeout.signal.aborted) abort()
    else timeout.signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([operation, expired]) }
  finally { timeout[Symbol.dispose]() }
}

function sessionEvent(notification: HarnessNotification): SessionEvent | undefined {
  if (notification.method !== 'session.event' || notification.params.sessionId !== sessionId) return undefined
  return notification.params.event as SessionEvent
}

async function seedOverdueSchedule(sessions: string): Promise<void> {
  const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
  const id = SessionId(sessionId)
  try {
    const writer = await backend.open(id, 'write')
    try {
      const stored = await writer.read()
      const session = Session.create(id, stored.events, writer.header, writer.inheritedEventCount)
      const from = SessionLogOffset(stored.events.length)
      session.append('schedule/change', { version: 1, operation: 'create', schedule: { id: scheduleId, kind: 'at',
        prompt: schedulePrompt, scheduledAt: '2020-01-01T00:00:00.000Z' } })
      await writer.append(session.snapshotEvents(from))
      await writer.flush()
    } finally { await writer.close() }
  } finally { await backend.close() }
}

it('reuses durable workspace instructions and a due reminder across a cold-restored SDK Session', async () => {
  const originReady = Promise.withResolvers<void>()
  const originFailure = Promise.withResolvers<void>()
  const originPluginLoaded = Promise.withResolvers<void>()
  const originRootWaiting = Promise.withResolvers<void>()
  const originRootRejected = Promise.withResolvers<void>()
  const scheduleSeedRequested = Promise.withResolvers<void>()
  const scheduleSeedReady = Promise.withResolvers<void>()
  const owners: OriginOwner[] = []
  const originPluginPids: number[] = []
  const requests: ModelRequest[] = []
  const serverFailures: unknown[] = []
  const readinessFailures: { first?: { message?: string }; late?: { message?: string }; ownersAtRejection?: number; requestsAtRejection?: number }[] = []
  const startWaiters: Array<(value: 'start' | 'cancel') => void> = []
  const startTickets: Array<'start' | 'cancel'> = []
  let stage = 'prepare native SDK scheduled-origin fixture'
  let home: string | undefined
  let waiting: DeepSeekHarness | undefined
  let initializing: DeepSeekHarness | undefined
  let restored: DeepSeekHarness | undefined
  let pythonCompletion: Promise<{ readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly error: unknown }> | undefined
  let primaryFailure: unknown
  const report = () => ({ stage, owners, requests: requests.length, readinessFailures, serverFailures })
  const updateStage = (value: string): void => {
    stage = value
    process.stderr.write(`native SDK scheduled-origin stage: ${stage}\n`)
  }
  const assignStart = (value: 'start' | 'cancel'): void => {
    const waiter = startWaiters.shift()
    if (waiter === undefined) startTickets.push(value)
    else waiter(value)
  }
  const server = createServer((request, response) => {
    const handle = async (): Promise<void> => {
      const waitForReceipt = async (receipt: Promise<void>, value: string): Promise<void> => {
        const abandoned = new Promise<void>(resolve => response.once('close', resolve))
        await Promise.race([receipt, abandoned])
        if (!response.writableEnded) response.end(value)
      }
      if (request.url === '/await-origin-plugin-loaded') {
        await waitForReceipt(originPluginLoaded.promise, 'ready')
        return
      }
      if (request.url === '/await-origin-root-waiting') {
        await waitForReceipt(originRootWaiting.promise, 'waiting')
        return
      }
      if (request.url === '/await-origin-root-rejected') {
        await waitForReceipt(originRootRejected.promise, 'rejected')
        return
      }
      if (request.url === '/await-origin-start') {
        const ticket = startTickets.shift() ?? await new Promise<'start' | 'cancel'>(resolve => {
          const waiter = (value: 'start' | 'cancel'): void => resolve(value)
          startWaiters.push(waiter)
          response.once('close', () => {
            const index = startWaiters.indexOf(waiter)
            if (index >= 0) startWaiters.splice(index, 1)
            resolve('cancel')
          })
        })
        if (!response.writableEnded) response.end(ticket)
        return
      }
      if (request.url === '/start-origin' || request.url === '/cancel-origin-start') {
        assignStart(request.url === '/start-origin' ? 'start' : 'cancel')
        response.end('accepted')
        return
      }
      if (request.url === '/await-origin-ready') {
        const abandoned = new Promise<void>(resolve => response.once('close', resolve))
        await Promise.race([originReady.promise, originFailure.promise, abandoned])
        if (serverFailures.length > 0) throw new Error(`fixture failure: ${String(serverFailures[0])}`)
        if (!response.writableEnded) response.end('ready')
        return
      }
      if (request.url === '/await-schedule-seed') {
        scheduleSeedRequested.resolve()
        await waitForReceipt(scheduleSeedReady.promise, 'ready')
        return
      }
      if (request.url === '/origin-owner') {
        owners.push(JSON.parse(await readBody(request)) as OriginOwner)
        response.end('ok')
        return
      }
      if (request.url === '/origin-plugin-loaded') {
        const { pid } = JSON.parse(await readBody(request)) as { pid: number }
        originPluginPids.push(pid)
        originPluginLoaded.resolve()
        response.end('ok')
        return
      }
      if (request.url === '/origin-root-ready-waiting') {
        originRootWaiting.resolve()
        response.end('ok')
        return
      }
      if (request.url === '/origin-root-ready-rejected') {
        const failure = JSON.parse(await readBody(request)) as { first?: { message?: string }; late?: { message?: string } }
        readinessFailures.push({ ...failure, ownersAtRejection: owners.length, requestsAtRejection: requests.length })
        originRootRejected.resolve()
        response.end('ok')
        return
      }
      if (request.url === '/origin-ready') {
        originReady.resolve()
        response.end('ok')
        return
      }
      if (request.url === '/origin-failure') {
        const failure = JSON.parse(await readBody(request)) as { message?: string }
        serverFailures.push(failure)
        originFailure.resolve()
        response.end('ok')
        return
      }
      const modelRequest = JSON.parse(await readBody(request)) as ModelRequest
      requests.push(modelRequest)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(sse(finalResponse))
    }
    void handle().catch(failure => {
      serverFailures.push(failure)
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' })
      if (!response.writableEnded) response.end(failure instanceof Error ? failure.message : String(failure))
      originFailure.resolve()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native SDK scheduled-origin: missing test endpoint')
  const controlUrl = `http://127.0.0.1:${address.port}`
  const post = async (path: string): Promise<string> => {
    const response = await fetch(`${controlUrl}${path}`, { method: 'POST', signal: AbortSignal.timeout(15_000) })
    const text = await response.text()
    if (!response.ok) throw new Error(`native SDK scheduled-origin: ${path} returned ${response.status}: ${text}`)
    return text
  }
  const get = async (path: string): Promise<string> => {
    const response = await fetch(`${controlUrl}${path}`, { signal: AbortSignal.timeout(15_000) })
    const text = await response.text()
    if (!response.ok) throw new Error(`native SDK scheduled-origin: ${path} returned ${response.status}: ${text}`)
    return text
  }
  try {
    home = mkdtempSync(join(tmpdir(), 'dsh-native-sdk-scheduled-origin-'))
    const workspacePath = join(home, 'workspace')
    const sessions = join(home, 'sessions')
    const patch = join(home, 'model.patch.json')
    mkdirSync(workspacePath)
    const workspace = realpathSync.native(workspacePath)
    mkdirSync(join(workspace, '.git'))
    writeFileSync(join(workspace, 'AGENTS.md'), `# Workspace fixture\n${workspaceInstruction}\n`)
    writeFileSync(join(home, 'AGENTS.md'), `# Isolated global fixture\n${globalInstruction}\n`)
    const profile = join(home, 'profiles', 'native-sdk')
    const fixturePackage = join(profile, 'node_modules', 'fixture-sdk-scheduled-origin')
    mkdirSync(fixturePackage, { recursive: true })
    const fixtureUrl = pathToFileURL(join(root, 'snapshots/native-sdk/text-turn/scheduled-origin.mjs')).href
    const { plugin } = await import(fixtureUrl) as { plugin: {
      apiVersion: number; targets: string[]; requires: string[]; optional?: string[]; provides: string[]
    } }
    writeFileSync(join(fixturePackage, 'native.mjs'), `export { plugin } from ${JSON.stringify(fixtureUrl)}\n`)
    writeFileSync(join(fixturePackage, 'package.json'), JSON.stringify({ name: 'fixture-sdk-scheduled-origin', version: '0.0.0', type: 'module',
      exports: { './package.json': './package.json', './native': './native.mjs' },
      dsh: { native: { apiVersion: plugin.apiVersion, entry: './native', targets: plugin.targets,
        requires: plugin.requires, optional: plugin.optional ?? [], provides: plugin.provides } } }))
    const composition = shippedNativeProfileComposition(home, 'native-sdk')
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-scheduled-origin-fixture', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: [
      ...composition.installations,
      { id: 'task-scheduler', plugin: '@deepseek-ai/dsh-task-scheduler', scope: 'root',
        config: { path: join(home, 'profiles', 'native-sdk', 'task-scheduler.sqlite') } },
      { id: 'schedule', plugin: '@deepseek-ai/dsh-schedule', scope: 'root' },
      { id: 'fixture-sdk-scheduled-origin', plugin: 'fixture-sdk-scheduled-origin', scope: 'root',
        config: { controlUrl, sessionId } },
    ] }))
    writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { systemPrompt: 'Report the restored scheduled root result.', maxSteps: 2 } },
      { id: 'storage', config: { root: sessions, compression: 'none' } },
      { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
        baseURL: `${controlUrl}/v1`, models: [{ id: 'fixture-model', input: ['text'] }] } } } },
    ] }))
    const options = { profile: 'native-sdk', dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'), dshHome: home,
      patches: [patch], cwd: workspace,
      provider: 'fixture', model: 'fixture-model',
      env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' }, requestTimeoutMs: 20_000 }
    const serializeRun = (result: RunResult) => ({ finalResponse: result.finalResponse, events: result.events,
      notifications: result.notifications })
    let run: ReturnType<typeof serializeRun>
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      updateStage('start Python SDK and initialize the native SDK server')
      const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
      writeFileSync(launcher, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" "$@"\n`)
      if (process.platform !== 'win32') chmodSync(launcher, 0o700)
      updateStage('start SDK without initialize and verify readiness cancellation')
      pythonCompletion = execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(root, 'snapshots/native-sdk/text-turn/client.py'),
        launcher, home, workspace, patch, firstPrompt, prompt, 'scheduled-origin'], {
        env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'),
          NATIVE_SDK_FIXTURE_KEY: 'fixture-key', NATIVE_SDK_SCHEDULED_ORIGIN_CONTROL_URL: controlUrl }, timeout: 45_000,
      }).then(result => ({ ok: true as const, stdout: result.stdout }), error => ({ ok: false as const, error }))
      await waitFor('Python SDK pauses between Host processes', Promise.race([
        scheduleSeedRequested.promise.then(() => undefined),
        pythonCompletion.then(outcome => {
          if (!outcome.ok) throw outcome.error
          throw new Error('Python SDK exited before the cold-restore schedule seed')
        }),
      ]), report)
      updateStage('persist one overdue reminder between Python SDK Host processes')
      await seedOverdueSchedule(sessions)
      scheduleSeedReady.resolve()
      const python = await pythonCompletion
      if (!python.ok) throw python.error
      const output = JSON.parse(python.stdout) as { run: ReturnType<typeof serializeRun> }
      run = output.run
    } else {
      updateStage('start SDK without initialize and verify readiness cancellation')
      waiting = new DeepSeekHarness(options)
      waiting.client.start()
      expect(await get('/await-origin-plugin-loaded')).toBe('ready')
      await post('/start-origin')
      expect(await get('/await-origin-root-waiting')).toBe('waiting')
      await waitFor('close SDK while root readiness awaits initialize', waiting.close(), report)
      waiting = undefined
      expect(await get('/await-origin-root-rejected')).toBe('rejected')
      expect(readinessFailures).toHaveLength(1)
      expect(readinessFailures[0]).toMatchObject({ first: { message: expect.stringContaining('closing') as unknown },
        late: { message: expect.any(String) as unknown } })
      expect(owners).toHaveLength(0)
      expect(requests).toHaveLength(0)
      updateStage('initialize the native SDK server before scheduled-root maintenance')
      initializing = new DeepSeekHarness(options)
      await waitFor('SDK initialize', initializing.start(), report)
      updateStage('admit one scheduled root through the real Program maintenance route')
      await post('/start-origin')
      const readyResponse = await fetch(`${controlUrl}/await-origin-ready`, { signal: AbortSignal.timeout(15_000) })
      if (!readyResponse.ok || await readyResponse.text() !== 'ready') throw new Error('native SDK scheduled-origin: maintenance did not settle')
      updateStage('send the first workspace-guided prompt through the initialized SDK Host')
      const first = await waitFor('first workspace-guided SDK prompt settles',
        initializing.session(sessionId).run(firstPrompt), report)
      expect(first.finalResponse).toBe(finalResponse)
      await waitFor('close initialized SDK Host', initializing.close(), report)
      initializing = undefined
      updateStage('persist one overdue reminder between SDK Host processes')
      await seedOverdueSchedule(sessions)
      updateStage('cold restore the same scheduled root through a fresh public SDK prompt')
      restored = new DeepSeekHarness(options)
      const result = await waitFor('cold restored SDK prompt settles',
        restored.session(sessionId).run(prompt), report)
      run = serializeRun(result)
      await waitFor('close restored SDK Host', restored.close(), report)
      restored = undefined
    }

    expect(readinessFailures).toHaveLength(1)
    expect(readinessFailures[0]).toMatchObject({ first: { message: expect.stringContaining('closing') as unknown },
      late: { message: expect.any(String) as unknown }, ownersAtRejection: 0, requestsAtRejection: 0 })
    updateStage('assert durable marker, owner classification, and raw SDK projection')
    expect(owners).toHaveLength(3)
    for (const owner of owners) expect(owner).toMatchObject({ sessionId, invocation: 'root',
      rootOrigin: 'scheduled', taskScheduleToolVisible: false })
    expect(requests).toHaveLength(3)
    expect(originPluginPids).toHaveLength(3)
    expect(new Set(originPluginPids).size).toBe(3)
    const requestAdmissions = requests.map(request => (request.messages ?? []).filter(message => message.role === 'user')
      .flatMap(message => {
        const text = requestText([message])
        return [firstPrompt, prompt, schedulePrompt].filter(input => text.includes(input))
      }))
    expect(requestAdmissions.slice(0, 2)).toEqual([[firstPrompt], [firstPrompt, prompt]])
    expect(requestAdmissions[2]).toEqual([firstPrompt, prompt, schedulePrompt])
    const modelRequestsText = requests.map(request => requestText(request.messages))
    expect(modelRequestsText.join('\n')).toContain(workspaceInstruction)
    expect(modelRequestsText.join('\n')).toContain(globalInstruction)
    const toolNames = (requests[0]?.tools ?? []).flatMap(tool => tool.function?.name === undefined ? [] : [tool.function.name])
    expect(toolNames).not.toContain('task_schedule')
    expect(toolNames).toEqual(expect.arrayContaining(['schedule_create', 'schedule_list', 'schedule_delete']))
    expect(run.finalResponse).toBe(finalResponse)
    const wireEvents = run.notifications.flatMap(notification => {
      const event = sessionEvent(notification)
      return event === undefined ? [] : [event]
    })
    expect(wireEvents.some(event => event.type === 'session/root-origin')).toBe(false)
    expect(run.events).toEqual(wireEvents)
    const scheduleInbox = run.events.find(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message =>
      message.source.kind === 'plugin' && message.source.plugin === 'schedule'
      && message.content.some(block => block.type === 'text' && block.text.includes(schedulePrompt))))
    const scheduleDispatch = run.events.find(event => event.type === 'schedule/change'
      && event.data.operation === 'dispatch' && event.data.id === scheduleId)
    const scheduledPromptInput = run.events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'schedule'
      && event.data.content.some(block => block.type === 'text' && block.text.includes(schedulePrompt)))
    const restoredPromptInput = run.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user'
      && event.data.content.some(block => block.type === 'text' && block.text.includes(prompt)))
    if (scheduleInbox?.type !== 'agent/inbox/spliced' || scheduleDispatch?.type !== 'schedule/change'
      || scheduledPromptInput?.type !== 'user/message' || restoredPromptInput?.type !== 'user/message') {
      throw new Error('native SDK scheduled-origin: queued reminder projection missing from RunResult')
    }
    const queuedScheduleMessage = scheduleInbox.data.inserted.find(message => message.id === scheduledPromptInput.data.id)
    const restoredTurnEnd = run.events.find(event => event.type === 'turn/end'
      && event.seq > restoredPromptInput.seq && event.seq < scheduleInbox.seq)
    const scheduleTurnStart = run.events.find(event => event.type === 'turn/start'
      && event.seq > scheduleDispatch.seq && event.seq < scheduledPromptInput.seq)
    const scheduleTurnAssistant = run.events.find(event => event.type === 'assistant/message'
      && event.seq > scheduledPromptInput.seq)
    const scheduleTurnEnd = run.events.find(event => event.type === 'turn/end'
      && event.seq > scheduledPromptInput.seq)
    if (queuedScheduleMessage === undefined || restoredTurnEnd?.type !== 'turn/end'
      || scheduleTurnStart?.type !== 'turn/start' || scheduleTurnAssistant?.type !== 'assistant/message'
      || scheduleTurnEnd?.type !== 'turn/end') {
      throw new Error('native SDK scheduled-origin: restored and scheduled turn ordering missing')
    }
    expect(restoredPromptInput.seq).toBeLessThan(restoredTurnEnd.seq)
    expect(restoredTurnEnd.seq).toBeLessThan(scheduleInbox.seq)
    expect(scheduleInbox.seq).toBeLessThan(scheduleDispatch.seq)
    expect(scheduleDispatch.seq).toBeLessThan(scheduleTurnStart.seq)
    expect(scheduleTurnStart.seq).toBeLessThan(scheduledPromptInput.seq)
    expect(scheduledPromptInput.seq).toBeLessThan(scheduleTurnAssistant.seq)
    expect(scheduleTurnAssistant.seq).toBeLessThan(scheduleTurnEnd.seq)
    expect(scheduleTurnStart.data.turn).toBe(scheduleTurnAssistant.data.turn)
    expect(scheduleTurnAssistant.data.turn).toBe(scheduleTurnEnd.data.turn)
    expect(scheduleTurnEnd.data.turn).not.toBe(restoredTurnEnd.data.turn)
    const input = run.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    if (input?.type !== 'user/message') throw new Error('native SDK scheduled-origin: user input missing from RunResult')
    const receipt = run.events.find(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === input.data.id))
    const assistant = run.events.find(event => event.type === 'assistant/message')
    const end = run.events.find(event => event.type === 'turn/end')
    const logNames = readdirSync(sessions, { recursive: true }).filter(name => String(name).endsWith('session.v3.jsonl'))
    expect(logNames).toHaveLength(1)
    const raw = readFileSync(join(sessions, String(logNames[0])), 'utf8')
    const events = parseSessionLog(raw)
    const rawScheduleCreate = events.find(event => event.type === 'schedule/change'
      && event.data.operation === 'create' && event.data.schedule.id === scheduleId)
    const rawScheduleDispatch = events.find(event => event.type === 'schedule/change'
      && event.data.operation === 'dispatch' && event.data.id === scheduleId)
    const rawScheduleInbox = events.find(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === queuedScheduleMessage.id))
    const rawRestoredInput = events.find(event => event.type === 'user/message' && event.data.id === restoredPromptInput.data.id)
    const rawScheduledInput = events.find(event => event.type === 'user/message' && event.data.id === scheduledPromptInput.data.id)
    const rawRestoredEnd = events.find(event => event.type === 'turn/end' && event.seq === restoredTurnEnd.seq)
    const rawScheduleStart = events.find(event => event.type === 'turn/start' && event.seq === scheduleTurnStart.seq)
    const rawScheduleAssistant = events.find(event => event.type === 'assistant/message' && event.seq === scheduleTurnAssistant.seq)
    const rawScheduleEnd = events.find(event => event.type === 'turn/end' && event.seq === scheduleTurnEnd.seq)
    if (rawScheduleCreate?.type !== 'schedule/change' || rawScheduleDispatch?.type !== 'schedule/change'
      || rawScheduleInbox?.type !== 'agent/inbox/spliced' || rawRestoredInput?.type !== 'user/message'
      || rawScheduledInput?.type !== 'user/message' || rawRestoredEnd?.type !== 'turn/end'
      || rawScheduleStart?.type !== 'turn/start' || rawScheduleAssistant?.type !== 'assistant/message'
      || rawScheduleEnd?.type !== 'turn/end') {
      throw new Error('native SDK scheduled-origin: durable schedule turn linkage missing')
    }
    expect([rawScheduleCreate.seq, rawRestoredInput.seq, rawRestoredEnd.seq, rawScheduleInbox.seq,
      rawScheduleDispatch.seq, rawScheduleStart.seq, rawScheduledInput.seq, rawScheduleAssistant.seq, rawScheduleEnd.seq])
      .toEqual([rawScheduleCreate.seq, rawRestoredInput.seq, rawRestoredEnd.seq, rawScheduleInbox.seq,
        rawScheduleDispatch.seq, rawScheduleStart.seq, rawScheduledInput.seq, rawScheduleAssistant.seq, rawScheduleEnd.seq]
        .sort((left, right) => left - right))
    expect(events.filter(event => event.type === 'schedule/change').map(event => event.data.operation)).toEqual(['create', 'dispatch'])
    const markers = events.filter(event => event.type === 'session/root-origin')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ ignorable: true, data: { origin: 'scheduled' } })
    const instructionEvents = events.filter((event): event is Extract<SessionEvent, { type: 'user/message' }> =>
      event.type === 'user/message' && event.data.source.kind === 'agent-instructions')
    expect(instructionEvents).toHaveLength(1)
    const instructionText = instructionEvents[0]!.data.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(instructionText).toContain(workspaceInstruction)
    expect(instructionText).toContain(globalInstruction)
    for (const modelRequest of requests) {
      const text = requestText(modelRequest.messages)
      expect(text).toContain(instructionText)
      expect(text.split(instructionText)).toHaveLength(2)
    }
    const rawInput = events.find(event => event.type === 'user/message' && event.data.id === input.data.id)
    if (rawInput?.type !== 'user/message' || receipt?.type !== 'agent/inbox/spliced'
      || assistant?.type !== 'assistant/message' || end?.type !== 'turn/end') {
      throw new Error('native SDK scheduled-origin: durable turn ordering events missing')
    }
    const rawReceipt = events.find(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === rawInput.data.id))
    const rawAssistant = events.find((event): event is Extract<SessionEvent, { type: 'assistant/message' }> =>
      event.type === 'assistant/message' && event.seq === assistant.seq)
    const rawEnd = events.find((event): event is Extract<SessionEvent, { type: 'turn/end' }> =>
      event.type === 'turn/end' && event.seq === end.seq)
    expect(rawReceipt).toBeDefined()
    expect(rawAssistant).toBeDefined()
    expect(rawEnd).toBeDefined()
    expect(rawAssistant?.data.turn).toBe(assistant.data.turn)
    expect(rawEnd?.data.turn).toBe(end.data.turn)
    expect(assistant.data.turn).toBe(end.data.turn)
    expect(events.indexOf(markers[0]!)).toBeLessThan(events.indexOf(rawReceipt!))
    expect(events.indexOf(rawReceipt!)).toBeLessThan(events.indexOf(rawInput))
    expect(events.indexOf(rawInput)).toBeLessThan(events.indexOf(rawAssistant!))
    expect(events.indexOf(rawAssistant!)).toBeLessThan(events.indexOf(rawEnd!))
    expect(end).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const idleIndex = run.notifications.findIndex(notification => notification.method === 'session.status'
      && notification.params.sessionId === sessionId && notification.params.status === 'idle')
    const endIndex = run.notifications.findIndex(notification => sessionEvent(notification)?.type === 'turn/end')
    expect(idleIndex).toBeGreaterThan(endIndex)

    const redacted = redactSessionSnapshotIds([raw])[0] ?? raw
    const normalized = normalizeSessionSnapshot(redacted, { sessionIds: [], cwd: workspace }, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, { sessionIds: [], cwd: workspace })
    const schemas = normalizedToolSchemas(raw, { sessionIds: [], cwd: workspace })
    if (prompts[0] === undefined || schemas[0] === undefined) {
      throw new Error('native SDK scheduled-origin: model request header missing')
    }
    const evidencePath = process.env.DSH_SCHEDULED_ORIGIN_EVIDENCE_PATH
    if (evidencePath !== undefined) writeFileSync(evidencePath, JSON.stringify({
      language: process.env.DSH_NATIVE_SDK_PYTHON === undefined ? 'typescript' : 'python',
      readinessFailures,
      owners,
      originPluginPids,
      modelRequests: requests,
      result: run,
      rawSession: raw,
    }, null, 2))
    const promptSnapshot = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const schemaSnapshot = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    const admissionSnapshot = `${JSON.stringify([
      { input: firstPrompt, source: 'user', outcome: 'completed', taskScheduleToolVisible: false, scheduleToolsVisible: true },
      { input: prompt, source: 'user', outcome: 'completed', taskScheduleToolVisible: false, scheduleToolsVisible: true },
      { input: schedulePrompt, source: 'schedule', outcome: 'completed', taskScheduleToolVisible: false, scheduleToolsVisible: true },
    ], null, 2)}\n`
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(fixture, normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), promptSnapshot)
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), schemaSnapshot)
      writeFileSync(join(scenario, 'model-admissions.expected.json'), admissionSnapshot)
    } else {
      expect(normalized).toBe(readFileSync(fixture, 'utf8'))
      expect(promptSnapshot).toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(schemaSnapshot).toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
      expect(admissionSnapshot).toBe(readFileSync(join(scenario, 'model-admissions.expected.json'), 'utf8'))
    }
  } catch (failure) {
    primaryFailure = failure
    const error = failure instanceof Error ? failure as Error & { stderr?: string; stdout?: string } : undefined
    process.stderr.write(`native SDK scheduled-origin failure: ${JSON.stringify({ stage, cause: error === undefined
      ? failure : { name: error.name, message: error.message, stack: error.stack, stderr: error.stderr,
        stdout: error.stdout }, report: report() })}\n`)
    throw failure
  } finally {
    scheduleSeedReady.resolve()
    if (pythonCompletion !== undefined) await pythonCompletion
    assignStart('cancel')
    const cleanupFailures: unknown[] = []
    for (const harness of [restored, initializing, waiting]) {
      if (harness === undefined) continue
      try { await harness.close() }
      catch (failure) { cleanupFailures.push(failure) }
    }
    await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
    if (cleanupFailures.length > 0) {
      throw new AggregateError(primaryFailure === undefined ? cleanupFailures : [primaryFailure, ...cleanupFailures],
        'native SDK scheduled-origin fixture cleanup failed')
    }
  }
})
