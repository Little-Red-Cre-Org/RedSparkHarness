/** Real native Host continuation turns share the selected model executor and released Session writer. */
import { mkdtemp, rm } from 'node:fs/promises'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type InstallationRequest, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin, NativeAgentId, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as executionPlugin, type NativeSessionExecutionOperations,
  type NativeActiveSessionOperations, type NativeActiveSessionOwner,
  type NativeStepAdmissionCommitCheck } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { plugin as goalPlugin, type NativeGoalOperations } from '@deepseek-ai/dsh-goal/native'
import { plugin as driverPlugin, NativeGoalRoundDriver, resolveNativeGoalDriverConfig } from '../src/native.ts'
import { plugin as commandsPlugin, type NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import { plugin as goalCommandPlugin } from '../../command-goal/src/native.ts'
import { plugin as goalToolsPlugin } from '../../tool-goal/src/native.ts'
import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgentInstructions } from '@deepseek-ai/dsh-agent-instructions/native'
import { foldGoal } from '@deepseek-ai/dsh-goal/projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { NativeHeadlessApplication, plugin as appPlugin } from '@deepseek-ai/dsh-native-headless/native'

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], prepareInstructions?: NativeAgentInstructions['prepare']) {
  const root = await mkdtemp(join(tmpdir(), 'rsh-continuation-host-'))
  const scope = new NativeScope()
  const model = new MockAdapter(script)
  let app: NativeHeadlessApplication | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let agents: NativeAgentRegistry | undefined
  let execution: NativeSessionExecutionOperations | undefined
  let tools: NativeToolRegistry | undefined
  let commands: NativeCommandOperations | undefined
  let goals: NativeGoalOperations | undefined
  let activeSessions: NativeActiveSessionOperations | undefined
  let continuation: NativeGoalRoundDriver | undefined
  const capture: NativePlugin = { apiVersion: 1, name: 'continuation-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'agents', 'sessionExecution', 'tools', 'activeSessions',
      'goals', 'commands', 'goalContinuation'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      storage = context.require('sessionPersistence')
      agents = context.require('agents')
      execution = context.require('sessionExecution')
      tools = context.require('tools')
      activeSessions = context.require('activeSessions')
      goals = context.require('goals')
      commands = context.require('commands')
      const driver = context.require('goalContinuation')
      if (!(driver instanceof NativeGoalRoundDriver)) throw new Error('missing real Goal continuation driver')
      continuation = driver
    } }
  const modelProvider: NativePlugin = { apiVersion: 1, name: 'continuation-model', targets: ['host'],
    requires: [], provides: ['model'], resolve: () => (context) => { context.provide('model', model) } }
  const instructions: NativeAgentInstructions = {
    seed: (..._args: Parameters<NativeAgentInstructions['seed']>) => {},
    prepare: async (session: Parameters<NativeAgentInstructions['prepare']>[0],
      inputs: Parameters<NativeAgentInstructions['prepare']>[1], signal: Parameters<NativeAgentInstructions['prepare']>[2]) =>
      await prepareInstructions?.(session, inputs, signal),
  } as unknown as NativeAgentInstructions
  const instructionsProvider: NativePlugin = { apiVersion: 1, name: 'continuation-instructions', targets: ['host'],
    requires: [], provides: ['agentInstructions'], resolve: () => context => context.provide('agentInstructions', instructions) }
  const installation: InstallationRequest[] = [
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 4 } },
    { plugin: executionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: goalPlugin, scope, config: { defaultMaxGoalRounds: 2 } },
    { plugin: driverPlugin, scope, config: undefined },
    { plugin: goalToolsPlugin, scope, config: { blockedAfterConsecutiveRounds: 1 } },
    { plugin: commandsPlugin, scope, config: undefined }, { plugin: goalCommandPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: modelProvider, scope, config: undefined },
  ]
  if (prepareInstructions !== undefined) installation.push({ plugin: instructionsProvider, scope, config: undefined })
  const host = new NativeHost(resolveInstallation(installation, 'host'))
  await host.start()
  if (app === undefined || storage === undefined || agents === undefined || execution === undefined || tools === undefined
    || activeSessions === undefined || goals === undefined || commands === undefined || continuation === undefined) {
    throw new Error('missing continuation fixture services')
  }
  return { root, host, scope, model, app, storage, agents, execution, tools, activeSessions, goals, commands, continuation,
    async close() { await host.stop(); await rm(root, { recursive: true }) } }
}


vi.setConfig({ testTimeout: 15_000 })

it('runs bounded automatic Goal rounds through one root Agent, one durable writer and the selected executor', async () => {
  const state = await fixture([
    toolCallResponse('create', 'create_goal', { objective: 'Finish two bounded rounds.', max_goal_rounds: 2 }),
    textResponse('Goal armed.'), textResponse('Round one.'), textResponse('Round two.'),
  ])
  const id = SessionId('native-goal-rounds')
  const closed = Promise.withResolvers<undefined>()
  const originalCreate = state.storage.create.bind(state.storage)
  const create = vi.spyOn(state.storage, 'create').mockImplementation(async (...args) => {
    const writer = await originalCreate(...args)
    const close = writer.close.bind(writer)
    vi.spyOn(writer, 'close').mockImplementation(async () => { await close(); closed.resolve(undefined) })
    return writer
  })
  try {
    await state.app.executeTurn({ id, resume: false, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Create an explicit Goal and do two rounds.' }] }) }, new AbortController().signal)
    await closed.promise
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      expect(events.filter(event => event.type === 'turn/end').map(event => event.data.turn)).toEqual([1, 2, 3])
      expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')
        .map(event => event.type === 'user/message' ? event.data.source : undefined)).toEqual([
        expect.objectContaining({ kind: 'goal', revision: 1, round: 1 }),
        expect.objectContaining({ kind: 'goal', revision: 1, round: 2 }),
      ])
      expect(events.filter(event => event.type === 'goal/change').at(-1)).toMatchObject({ data: {
        operation: 'block', goal: { phase: 'blocked', blockedReason: { code: 'round-limit' } }, roundsStarted: 2,
      } })
      expect(events.map(event => event.seq)).toEqual(events.map((_event, index) => index))
      expect(state.model.requests).toHaveLength(4)
      expect(JSON.stringify(state.model.requests.at(-1)?.messages)).toContain('Round one.')
      expect((await state.storage.list())).toHaveLength(1)
      const agent = state.agents.get(NativeAgentId(id))
      expect(agent).toBeDefined()
      if (agent === undefined) throw new Error('missing original root Agent')
      expect(() => state.goals.get(agent)).toThrow('Goal Agent is not live')
    } finally { await reader.close() }
  } finally { create.mockRestore(); await state.close() }
})


it('accepts completion only in the exact Goal round and logs final wrap-up before releasing residency', async () => {
  const id = SessionId('native-goal-complete')
  const state: Awaited<ReturnType<typeof fixture>> = await fixture([
    toolCallResponse('create', 'create_goal', { objective: 'Complete the admitted round.' }), textResponse('Goal armed.'),
    () => {
      const agent = state.agents.get(NativeAgentId(id))
      if (agent === undefined) throw new Error('missing root Agent')
      const goal = state.goals.get(agent)
      if (goal === undefined) throw new Error('missing current Goal')
      return toolCallResponse('complete', 'update_goal', { goal_id: goal.id, revision: goal.revision, action: 'complete' })
    }, textResponse('Final verified result.'),
  ])
  const closed = Promise.withResolvers<undefined>()
  const remove = state.activeSessions.onDetached(async () => { closed.resolve(undefined) })
  try {
    await state.app.executeTurn({ id, resume: false, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Create and complete this explicit Goal.' }] }) }, new AbortController().signal)
    await closed.promise
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      expect(events.filter(event => event.type === 'goal/change').at(-1)).toMatchObject({ data: {
        operation: 'complete', goal: { phase: 'complete' }, roundsStarted: 1,
      } })
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
      expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')).toHaveLength(1)
      expect(JSON.stringify(state.model.requests.at(-1)?.messages)).toContain('Complete the admitted round.')
      expect(events.filter(event => event.type === 'assistant/message').at(-1)).toMatchObject({
        data: { message: { content: [{ type: 'text', text: 'Final verified result.' }] } },
      })
    } finally { await reader.close() }
  } finally { await remove(); await state.close() }
})

it('rechecks the exact revision after downstream admission and discards a stale Goal input before any model request', async () => {
  const state = await fixture([toolCallResponse('create', 'create_goal', { objective: 'Original Goal.' }), textResponse('Armed.')])
  const id = SessionId('native-goal-cas')
  const waiting = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const detached = Promise.withResolvers<undefined>()
  const removals: (() => Promise<void>)[] = []
  let active: NativeActiveSessionOwner | undefined
  const remove = state.activeSessions.onAttached(async (owner) => {
    active = owner
    removals.push(owner.beforeStep(async (context, next) => {
      const decision = await next()
      if (context.candidates.some(message => message.source.kind === 'goal')) { waiting.resolve(undefined); await resume.promise }
      return decision
    }, 800))
  })
  const removeDetach = state.activeSessions.onDetached(async () => { detached.resolve(undefined) })
  try {
    await state.app.executeTurn({ id, resume: false, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Create an explicit Goal.' }] }) }, new AbortController().signal)
    await waiting.promise
    if (active === undefined) throw new Error('missing active Goal owner')
    const goal = state.goals.get(active.agent)
    if (goal === undefined) throw new Error('missing Goal')
    await state.goals.edit(active.agent, goal, { objective: 'Revised while admission awaited.' })
    resume.resolve(undefined)
    await detached.promise
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      expect(state.model.requests).toHaveLength(2)
      expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')).toHaveLength(0)
      expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'blocked' } } })
      expect(events.some(event => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled')).toBe(true)
      expect(events.filter(event => event.type === 'goal/change').at(-1)).toMatchObject({ data: {
        operation: 'edit', goal: { revision: 2, objective: 'Revised while admission awaited.', phase: 'active' },
      } })
    } finally { await reader.close() }
  } finally { resume.resolve(undefined); await remove(); await removeDetach(); await Promise.all(removals.map(release => release()))
    await state.close() }
})


it.each(['pause', 'edit'] as const)('rechecks a Goal after instructions preparation when it is %s', async (action) => {
  const ready = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const state = await fixture([
    toolCallResponse('create', 'create_goal', { objective: 'Original Goal.', max_goal_rounds: 1 }), textResponse('Armed.'),
    action === 'edit' ? textResponse('The revised objective was completed.') : textResponse('The queued user input was handled.'),
  ], async (_session, inputs) => {
    if (inputs.some(input => input.source.kind === 'goal')) { ready.resolve(undefined); await release.promise }
  })
  const id = SessionId(`native-goal-late-${action}`)
  const detached = Promise.withResolvers<undefined>()
  let active: NativeActiveSessionOwner | undefined
  const remove = state.activeSessions.onAttached(async (owner) => { active = owner })
  const removeDetach = state.activeSessions.onDetached(async () => { detached.resolve(undefined) })
  try {
    await state.app.executeTurn({ id, resume: false, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Create an explicit Goal.' }] }) }, new AbortController().signal)
    await ready.promise
    if (active === undefined) throw new Error('missing active Goal owner')
    const goal = state.goals.get(active.agent)
    if (goal === undefined) throw new Error('missing Goal')
    if (action === 'pause') {
      await state.goals.pause(active.agent, goal)
      await active.enqueue(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep this queued input.' }] }),
        'next-step', false, new AbortController().signal)
    } else await state.goals.edit(active.agent, goal, { objective: 'Revised Goal.' })
    release.resolve(undefined)
    await detached.promise
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      const inboxEvents = events.filter((event): event is Extract<SessionEvent, { type: 'agent/inbox/spliced' }> =>
        event.type === 'agent/inbox/spliced')
      const goalMessages = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(events.filter(event => event.type === 'turn/end').length)
      expect(inboxEvents.some(event => event.data.outcome === 'canceled' && event.data.target === 'next-turn')).toBe(true)
      expect(() => foldGoal(events)).not.toThrow()
      if (action === 'pause') {
        expect(goalMessages).toHaveLength(0)
        expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'user'
          && event.data.content.some(block => block.type === 'text' && block.text === 'Keep this queued input.'))).toBe(true)
        expect(inboxEvents.some(event => event.data.target === 'next-step'
          && event.data.inserted.some(message => message.content.some(block => block.type === 'text'
            && block.text === 'Keep this queued input.')))).toBe(true)
        expect(state.model.requests).toHaveLength(3)
        expect(JSON.stringify(state.model.requests.at(-1)?.messages)).toContain('Keep this queued input.')
        expect(foldGoal(events).goal).toMatchObject({ phase: 'paused' })
      } else {
        expect(goalMessages.map(event => event.type === 'user/message' ? event.data.source : undefined)).toEqual([
          expect.objectContaining({ kind: 'goal', revision: 2, round: 1 }),
        ])
        expect(state.model.requests).toHaveLength(3)
        expect(JSON.stringify(state.model.requests.at(-1)?.messages)).toContain('Revised Goal.')
        expect(foldGoal(events)).toMatchObject({ goal: { phase: 'blocked' }, roundsStarted: 1 })
      }
    } finally { await reader.close() }
  } finally { release.resolve(undefined); await remove(); await removeDetach(); await state.close() }
})


it('rejects asynchronous admission commit checks before logging the admitted input', async () => {
  const state = await fixture([toolCallResponse('create', 'create_goal', { objective: 'Never commit this Goal.' }), textResponse('Armed.')])
  const id = SessionId('native-goal-async-check')
  const detached = Promise.withResolvers<undefined>()
  const releases: (() => Promise<void>)[] = []
  const remove = state.activeSessions.onAttached(async (owner) => {
    releases.push(owner.beforeStep(async (context, next) => {
      const decision = await next()
      if (context.candidates.some(message => message.source.kind === 'goal')) {
        context.registerCommitCheck((async () => { throw new Error('late invalid async check') }) as unknown as NativeStepAdmissionCommitCheck)
      }
      return decision
    }, 900))
  })
  const removeDetach = state.activeSessions.onDetached(async () => { detached.resolve(undefined) })
  try {
    let executionError: unknown
    try {
      await state.app.executeRootTurn({ id, resume: false, message: createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Create an explicit Goal.' }] }) }, new AbortController().signal)
    } catch (error: unknown) { executionError = error }
    const describeExecution = (failure: unknown): unknown => failure instanceof AggregateError
      ? { message: failure.message, errors: failure.errors.map(describeExecution) }
      : failure instanceof Error ? { name: failure.name, message: failure.message, code: 'code' in failure ? failure.code : undefined }
        : String(failure)
    expect(executionError === undefined ? undefined : JSON.stringify(describeExecution(executionError)))
      .toContain('admission commit check must return message ids synchronously')
    await detached.promise
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      expect(state.model.requests).toHaveLength(2)
      expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')).toHaveLength(0)
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(events.filter(event => event.type === 'turn/end').length)
      expect(() => foldGoal(events)).not.toThrow()
    } finally { await reader.close() }
  } finally {
    await remove(); await removeDetach(); await Promise.all(releases.map(release => release()))
    await state.close()
  }
})


it('cancels an admitted automatic round and releases Goal residency before Host shutdown finishes', async () => {
  const state = await fixture([toolCallResponse('create', 'create_goal', { objective: 'Cancel ongoing autonomous work.' }),
    textResponse('Armed.'), 'hang-slow'])
  const id = SessionId('native-goal-cancel')
  const entered = Promise.withResolvers<undefined>()
  const originalStream = state.model.stream.bind(state.model)
  const stream = vi.spyOn(state.model, 'stream').mockImplementation(async function* (options) {
    if (state.model.requests.length === 2) entered.resolve(undefined)
    yield* originalStream(options)
  })
  try {
    await state.app.executeTurn({ id, resume: false, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Create this explicit Goal.' }] }) }, new AbortController().signal)
    await entered.promise
    await state.host.stop()
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      expect(events.filter(event => event.type === 'turn/end').at(-1)).toMatchObject({ data: { reason: { kind: 'aborted' } } })
      expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')).toHaveLength(1)
      expect(state.model.requests).toHaveLength(3)
    } finally { await reader.close() }
  } finally { stream.mockRestore(); await state.close() }
})


it('creates and pauses a first human Goal command, then cold-restores its direct command view without any model turn', async () => {
  const state = await fixture([])
  const id = SessionId('native-goal-human-commands')
  const signal = new AbortController().signal
  try {
    const outcomes = await state.app.executeSessionOperation({ id, resume: false }, async (owner, effectiveSignal) => {
      const created = await state.commands.dispatch({ agent: owner.agent, session: owner.session,
        line: '/goal Finish the native command slice.', attachments: [], signal: effectiveSignal })
      const paused = await state.commands.dispatch({ agent: owner.agent, session: owner.session,
        line: '/goal pause', attachments: [], signal: effectiveSignal })
      return [created, paused]
    }, signal)
    expect(outcomes[0]?.result.kind).toBe('success')
    expect(outcomes[0]?.result.text).toContain('Goal created')
    expect(outcomes[1]?.result.kind).toBe('success')
    expect(outcomes[1]?.result.text).toContain('Goal paused')
    const restored = await state.app.executeSessionOperation({ id, resume: true }, async (owner, effectiveSignal) =>
      await state.commands.dispatch({ agent: owner.agent, session: owner.session, line: '/goal', attachments: [], signal: effectiveSignal }), signal)
    expect(restored?.result.kind).toBe('success')
    expect(restored?.result.text).toContain('Status: paused')
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      expect(events.filter(event => event.type === 'command/run')).toHaveLength(3)
      expect(events.filter(event => event.type === 'command/done')).toHaveLength(3)
      expect(events.filter(event => event.type === 'goal/change').map(event => event.data.operation)).toEqual(['create', 'pause'])
      expect(events.some(event => event.type === 'turn/start' || event.type === 'user/message')).toBe(false)
      expect(state.model.requests).toHaveLength(0)
    } finally { await reader.close() }
  } finally { await state.close() }
})

it('drains owner hooks after contribution cleanup fails and returns the same disposal promise', async () => {
  const state = await fixture([])
  await state.continuation.dispose()
  const failure = new Error('contribution release failed')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const ownerReady = Promise.withResolvers<undefined>()
  const finishOperation = Promise.withResolvers<undefined>()
  const restores: (() => void)[] = []
  const originalAttached = state.activeSessions.onAttached.bind(state.activeSessions)
  const attached = vi.spyOn(state.activeSessions, 'onAttached').mockImplementation((observer) => {
    const remove = originalAttached(async (owner) => {
      const originalIdle = owner.onIdle.bind(owner)
      const idle = vi.spyOn(owner, 'onIdle').mockImplementation((callback) => {
        const removeIdle = originalIdle(callback)
        return async () => { await removeIdle(); entered.resolve(undefined); await release.promise }
      })
      restores.push(() => idle.mockRestore())
      await observer(owner)
    })
    return async () => { await remove(); throw failure }
  })
  const driver = new NativeGoalRoundDriver(state.goals, state.activeSessions,
    resolveNativeGoalDriverConfig(undefined), new AbortController().signal)
  const operation = state.app.executeSessionOperation({ id: SessionId('native-goal-release-failure'), resume: false },
    async () => { ownerReady.resolve(undefined); await finishOperation.promise }, new AbortController().signal)
  try {
    await ownerReady.promise
    const disposal = driver.dispose()
    expect(driver.dispose()).toBe(disposal)
    let settled = false
    const outcome = disposal.then(() => { settled = true; return undefined }, (error: unknown) => { settled = true; return error })
    await entered.promise
    expect(settled).toBe(false)
    release.resolve(undefined)
    const error = await outcome
    expect(error).toBeInstanceOf(AggregateError)
    if (!(error instanceof AggregateError)) throw new Error('missing aggregate cleanup failure')
    expect(error.errors).toEqual([failure])
    finishOperation.resolve(undefined)
    await operation
  } finally {
    release.resolve(undefined)
    finishOperation.resolve(undefined)
    await Promise.allSettled([operation, driver.dispose()])
    attached.mockRestore()
    for (const restore of restores) restore()
    await state.close()
  }
})
