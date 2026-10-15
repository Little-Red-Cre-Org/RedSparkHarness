/** Native Schedule uses the retained JSONL writer across a busy turn and does not replay a dispatch. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as sessionExecutionPlugin } from '@deepseek-ai/dsh-native-session-execution/native'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeModel } from '@deepseek-ai/dsh-native-model-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolExecution, NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { plugin as appPlugin, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { Session, SessionId, SessionLogOffset, SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { createAfterScheduleRecord, foldScheduleEvents, ScheduleId } from '../src/domain.ts'
import { plugin as schedulePlugin } from '../src/native.ts'

const answer = (text: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
]

async function readEvents(storage: NativeSessionPersistenceOperations, id: SessionId): Promise<readonly SessionEvent[]> {
  const reader = await storage.open(id, 'read')
  try { return (await reader.read()).events } finally { await reader.close() }
}

async function seedOverdueSchedule(storage: NativeSessionPersistenceOperations, id: SessionId, cwd: string): Promise<void> {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false }
  const session = Session.create(id, undefined, header)
  session.append('schedule/change', { version: 1, operation: 'create', schedule: createAfterScheduleRecord(
    ScheduleId('native-restart-reminder'), 'native restart reminder', 1, Date.now() - 60_000,
  ) })
  session.append('schedule/change', { version: 1, operation: 'create', schedule: createAfterScheduleRecord(
    ScheduleId('native-timer-reminder'), 'native timer reminder', 1, Date.now(),
  ) })
  const writer = await storage.create(header)
  try {
    await writer.append(session.snapshotEvents())
    await writer.flush()
  } finally { await writer.close() }
}

async function mount(root: string, model: NativeModel, observeOwner: (owner: NativeActiveSessionOwner) => void) {
  const cwd = join(root, 'workspace')
  await mkdir(cwd, { recursive: true })
  const scope = new NativeScope()
  let app: NativeHeadlessApplication | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let agents: NativeAgentRegistry | undefined
  let tools: NativeToolRegistry | undefined
  const modelProvider: NativePlugin = {
    apiVersion: 1, name: 'schedule-test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', model) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'schedule-test-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'agents', 'tools', 'activeSessions'], provides: [],
    resolve: () => (context) => {
      app = context.require('application') as NativeHeadlessApplication
      storage = context.require('sessionPersistence')
      agents = context.require('agents')
      tools = context.require('tools')
      context.effect(context.require('activeSessions').onAttached(async (owner) => { observeOwner(owner) }))
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: sessionExecutionPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: modelProvider, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd, provider: 'test', model: 'fixture', systemPrompt: 'Respond briefly.', maxSteps: 3 } },
    { plugin: capture, scope, config: undefined },
    { plugin: schedulePlugin, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (app === undefined || storage === undefined || agents === undefined || tools === undefined) {
    await host.stop()
    throw new Error('native Schedule fixture is missing an application service')
  }
  return { host, app, storage, agents, tools, cwd }
}

function toolCall(agent: NativeAgent, session: Session): NativeToolExecution {
  const appendEvent: NativeToolExecution['appendEvent'] = async (type, data, ...opts) => session.append(type, data, ...opts)
  return { agent, callId: ToolCallId(`schedule-${agent.id}`), name: 'schedule_list', arguments: {}, session,
    signal: new AbortController().signal, appendEvent }
}

it('dispatches after busy idle admission and does not replay the durable dispatch after a JSONL remount', async () => {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-schedule-jsonl-'))
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  const id = SessionId('native-schedule-jsonl-restart')
  const firstStarted = Promise.withResolvers<undefined>()
  const releaseFirst = Promise.withResolvers<undefined>()
  const firstIdleAttempt = Promise.withResolvers<undefined>()
  const timerIdleAttempt = Promise.withResolvers<{ readonly pending: Promise<void> }>()
  const timerTurnStarted = Promise.withResolvers<undefined>()
  const observed: string[][] = []
  let calls = 0
  let idleAttempts = 0
  let exactOwner: NativeActiveSessionOwner | undefined
  const model: NativeModel = {
    async *stream(options: GenerateOptions) {
      calls += 1
      observed.push(options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])))
      if (calls === 1) { firstStarted.resolve(undefined); await releaseFirst.promise }
      if (calls === 3) timerTurnStarted.resolve(undefined)
      yield* answer(calls === 1 ? 'First turn complete.' : 'Reminder received.')
    },
  }
  let first: Awaited<ReturnType<typeof mount>> | undefined
  let second: Awaited<ReturnType<typeof mount>> | undefined
  let unregisterChild: (() => Promise<void>) | undefined
  try {
    first = await mount(root, model, (owner) => {
      if (owner.session.id !== id || exactOwner !== undefined || owner.rootOperations === undefined) return
      exactOwner = owner
      const runIdle = owner.rootOperations.runIdle.bind(owner.rootOperations)
      vi.spyOn(owner.rootOperations, 'runIdle').mockImplementation((operation, signal) => {
        idleAttempts += 1
        if (idleAttempts === 1) firstIdleAttempt.resolve(undefined)
        const result = runIdle(operation, signal)
        if (idleAttempts === 2) timerIdleAttempt.resolve({ pending: result.then(() => {}) })
        return result
      })
    })
    await seedOverdueSchedule(first.storage, id, first.cwd)
    const running = first.app.executeRootTurn({ id, resume: true, message: createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Finish this turn while the reminder is due.' }],
    }) }, new AbortController().signal)
    await firstStarted.promise
    await firstIdleAttempt.promise
    expect(idleAttempts).toBe(1)
    if (exactOwner === undefined) throw new Error('the exact resumed root owner was not observed')

    const child: NativeAgent = { id: NativeAgentId('schedule-child'), scope: new NativeScope(exactOwner.agent.scope) }
    unregisterChild = first.agents.register(child)
    await expect(first.tools.executeModelCall(toolCall(child, exactOwner.session)))
      .resolves.toMatchObject({ value: { code: 'internal_error' } })
    await expect(first.tools.executeModelCall(toolCall(exactOwner.agent, Session.create(SessionId('schedule-foreign-session')))))
      .resolves.toMatchObject({ value: { code: 'internal_error' } })
    await unregisterChild()
    unregisterChild = undefined

    releaseFirst.resolve(undefined)
    await expect(running).resolves.toMatchObject({ exitCode: 0 })
    expect(idleAttempts).toBe(1)
    expect(calls).toBe(2)
    expect(observed[1]?.join('\n')).toContain('native restart reminder')
    const events = await readEvents(first.storage, id)
    const inboxSeq = events.find(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'plugin' && message.source.plugin === 'schedule'))?.seq
    const dispatches = events.filter(event => event.type === 'schedule/change' && event.data.operation === 'dispatch')
    expect(dispatches).toHaveLength(1)
    expect(inboxSeq).toBeDefined()
    expect(inboxSeq!).toBeLessThan(dispatches[0]!.seq)
    expect(foldScheduleEvents(events, SessionLogOffset(0)).active.map(record => record.id))
      .toEqual([ScheduleId('native-timer-reminder')])

    await vi.advanceTimersByTimeAsync(1_000)
    const { pending: timerMaintenance } = await timerIdleAttempt.promise
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all([timerMaintenance, timerTurnStarted.promise]),
        new Promise<never>((_resolve, reject) => {
          timeout = realSetTimeout(() => { reject(new Error('native timer delivery timed out')) }, 5_000)
        }),
      ])
    } finally {
      if (timeout !== undefined) realClearTimeout(timeout)
    }
    expect(idleAttempts).toBe(2)
    expect(calls).toBe(3)
    expect(observed[2]?.join('\n')).toContain('native timer reminder')
    const timerEvents = await readEvents(first.storage, id)
    const timerDispatch = timerEvents.find(event => event.type === 'schedule/change'
      && event.data.operation === 'dispatch' && event.data.id === ScheduleId('native-timer-reminder'))
    const timerInbox = timerEvents.find(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'plugin' && message.source.plugin === 'schedule'
        && message.content.some(block => block.type === 'text' && block.text.includes('native timer reminder'))))
    expect(timerInbox).toBeDefined()
    expect(timerDispatch).toBeDefined()
    expect(timerInbox!.seq).toBeLessThan(timerDispatch!.seq)
    expect(foldScheduleEvents(timerEvents, SessionLogOffset(0)).active).toEqual([])
    await first.host.stop()
    first = undefined

    let coldCalls = 0
    second = await mount(root, { async *stream() { coldCalls += 1; yield* answer('unexpected model call') } }, () => {})
    await second.app.executeSessionOperation({ id, resume: true }, async () => {}, new AbortController().signal)
    const remounted = await readEvents(second.storage, id)
    expect(coldCalls).toBe(0)
    expect(remounted.filter(event => event.type === 'schedule/change' && event.data.operation === 'dispatch')).toHaveLength(2)
  } finally {
    releaseFirst.resolve(undefined)
    try {
      await unregisterChild?.()
    } finally {
      try {
        await Promise.allSettled([first?.host.stop(), second?.host.stop()])
        await rm(root, { recursive: true, force: true })
      } finally {
        vi.useRealTimers()
      }
    }
  }
})
