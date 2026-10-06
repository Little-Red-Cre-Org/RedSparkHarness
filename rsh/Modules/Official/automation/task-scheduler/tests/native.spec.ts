/** Native Schedule uses actual Host profiles, idle maintenance and JSONL writer checkpoints. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { NativeAgentId } from '@deepseek-ai/dsh-native-agent'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner, NativeRootExecutionOperations,
  NativeRootExecutionRequest, NativeRootRoute, NativeRootRouteId, NativeRootSessionRequest } from '@deepseek-ai/dsh-native-session-execution'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'

import { textResponse, toolCallResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'

import { TaskStore } from '../src/store.ts'
import type { TaskId, TaskInput } from '../src/types.ts'
import { NativeTaskSchedulerRegistry } from '../src/native-registry.ts'
import { plugin as nativeSchedulerPlugin } from '../src/native.ts'

import { fixture } from './native-fixture.ts'

vi.setConfig({ testTimeout: 15_000 })

let nextToolCall = 0
async function invokeTaskTool(state: Awaited<ReturnType<typeof fixture>>, owner: NativeActiveSessionOwner,
  signal: AbortSignal, args: unknown, initiator = true) {
  const appendEvent: NativeToolExecution['appendEvent'] = async (type, data, ...opts) => owner.append(type, data, ...opts)
  const operation = () => state.tools.execute({ agent: owner.agent, callId: ToolCallId(`task-schedule-${++nextToolCall}`),
    name: 'task_schedule', arguments: args, session: owner.session, signal, appendEvent })
  return initiator ? state.agents.withInitiator(owner.agent, operation) : state.agents.withoutInitiator(operation)
}
function toolText(result: Awaited<ReturnType<typeof invokeTaskTool>>): string {
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('task_schedule did not return its canonical text result')
  return block.text
}
async function syntheticOwner(state: Awaited<ReturnType<typeof fixture>>, id: string, parent: NativeScope | undefined,
  invocation: 'root' | 'delegated') {
  const session = SessionId(id)
  const agent = { id: NativeAgentId(id), scope: new NativeScope(parent) }
  const releaseAgent = state.agents.register(agent)
  const owner = { agent, session: { id: session } as NativeActiveSessionOwner['session'], invocation,
    writerAvailable: true } as unknown as NativeActiveSessionOwner
  const releaseOwner = await state.activeSessions.register(owner)
  return { agent, owner, detach: releaseOwner, async dispose() { await releaseOwner(); await releaseAgent() } }
}

it('preserves a v4 database and admits a persisted plan after restart only on its captured route', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-task-scheduler-restart-'))
  const legacyPath = join(root, 'legacy.sqlite')
  const legacyTaskId = '2c501940-7d88-4ca1-9a9f-a79662b77040'
  const legacyRunId = '46480769-fb93-42e7-9268-52547204fbca'
  const legacyTarget = Date.now() + 60_000
  const legacyTask = { id: legacyTaskId, ownerSessionId: 'owner', title: 'Check tests', prompt: 'Run tests and report facts',
    workspace: root, agentPreset: 'standard', permissionPreset: 'read-only', provider: 'mock', model: 'parent',
    at: new Date(legacyTarget).toISOString(), state: 'active', nextAt: legacyTarget }
  const legacyRun = { id: legacyRunId, taskId: legacyTaskId, scheduledAt: legacyTarget, startedAt: legacyTarget,
    deadline: legacyTarget + 60_000, finishedAt: legacyTarget + 1000, state: 'completed', sessionId: 'legacy-session', detail: 'done' }
  const oldDatabase = new DatabaseSync(legacyPath)
  oldDatabase.exec('PRAGMA user_version=4; CREATE TABLE tasks (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(task_id, scheduled_at)); CREATE TABLE notice_reads (id TEXT PRIMARY KEY, run_id TEXT NOT NULL); CREATE TABLE notice_deleted (id TEXT PRIMARY KEY);')
  oldDatabase.prepare('INSERT INTO tasks VALUES (?, ?)').run(legacyTaskId, JSON.stringify(legacyTask))
  oldDatabase.prepare('INSERT INTO runs VALUES (?, ?, ?, ?)').run(legacyRunId, legacyTaskId, legacyTarget, JSON.stringify(legacyRun))
  oldDatabase.close()
  const upgraded = new TaskStore(legacyPath)
  try {
    expect(upgraded.tasks()).toEqual([legacyTask])
    expect(upgraded.runs()).toEqual([legacyRun])
  } finally { upgraded.close() }
  const version = new DatabaseSync(legacyPath)
  try { expect(version.prepare('PRAGMA user_version').get()?.['user_version']).toBe(5) }
  finally { version.close() }

  const taskPath = join(root, 'tasks.sqlite')
  let store = new TaskStore(taskPath)
  const scheduledAt = Date.now() - 1000
  const plan: TaskInput = { title: 'Restart', prompt: 'Check persisted work after restart.', workspace: root,
    nativeRoute: brandString<NativeRootRouteId>('root'),
    nativeConfiguration: { cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 4,
      builtinTools: true, reasoningEffort: ReasoningEffortId('low'), maxTokens: 128 },
    provider: 'mock', model: 'parent', at: new Date(scheduledAt).toISOString() }
  const incompatibleRoot = await mkdtemp(join(root, 'compatibility-'))
  const incompatibleStore = new TaskStore(join(incompatibleRoot, 'tasks.sqlite'))
  incompatibleStore.create('legacy-owner', { ...plan, workspace: incompatibleRoot, nativeRoute: undefined, nativeConfiguration: undefined,
    title: 'Legacy policy',
    agentPreset: 'standard', permissionPreset: 'read-only', at: new Date(Date.now() + 60_000).toISOString() }, Date.now(), 300)
  incompatibleStore.close()
  await expect(fixture([], incompatibleRoot)).rejects.toThrow('Native task scheduling cannot adopt compatibility presets')

  const stalePlan = store.create('task-owner', plan, scheduledAt - 1, 300)
  const staleDeleted = store.create('deleted-owner', { ...plan, title: 'Deleted stale plan',
    nativeConfiguration: { ...plan.nativeConfiguration!, builtinTools: false },
    at: new Date(Date.now() + 60_000).toISOString() }, Date.now(), 300)
  store.change('deleted-owner', staleDeleted.id, 'deleted')
  store.close()
  const drifted = await fixture([], root, false)
  try {
    await expect(drifted.scheduler.start()).rejects.toThrow('Persisted task configuration differs from the selected Program route')
    await drifted.app.executeSessionOperation({ id: SessionId('drifted-owner'), resume: false }, async (owner) => {
      expect(() => drifted.schedules.list(owner)).toThrow('Native task scheduler startup failed')
    }, new AbortController().signal)
    expect(drifted.model.requests).toHaveLength(0)
  } finally { await drifted.close() }

  store = new TaskStore(taskPath)
  store.change('task-owner', stalePlan.id, 'paused')
  store.close()
  const pausedDrift = await fixture([], root, false)
  try {
    await expect(pausedDrift.scheduler.start()).rejects.toThrow('Persisted task configuration differs from the selected Program route')
    expect(pausedDrift.model.requests).toHaveLength(0)
  } finally { await pausedDrift.close() }

  const invalidPlans = [
    { prompt: '请提醒我晚上看报告。', error: 'cannot adopt personal reminder modes' },
    { prompt: 'Finish the goal.', kind: 'goal' as const, completionCriteria: 'Verified', error: 'requires the Goal Provider batch' },
    { prompt: 'Inspect this project.', resumeSessionId: 'prior-session', error: 'cannot resume a previous execution Session' },
  ]
  for (const [index, invalid] of invalidPlans.entries()) {
    const path = join(root, `invalid-native-${index}.sqlite`)
    const invalidStore = new TaskStore(path)
    try {
      const task = invalidStore.create('invalid-owner', { ...plan, title: `Invalid ${index}`,
        prompt: invalid.prompt, at: new Date(Date.now() + 60_000).toISOString(),
        ...('kind' in invalid ? { kind: invalid.kind } : {}),
        ...('completionCriteria' in invalid ? { completionCriteria: invalid.completionCriteria } : {}) }, Date.now(), 300)
      if ('resumeSessionId' in invalid) {
        const database = new DatabaseSync(path)
        try {
          const body = JSON.parse(String(database.prepare('SELECT body FROM tasks WHERE id=?').get(task.id)?.['body'])) as Record<string, unknown>
          body.resumeSessionId = invalid.resumeSessionId
          database.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify(body), task.id)
        } finally { database.close() }
      }
      expect(() => new NativeTaskSchedulerRegistry(invalidStore, {} as unknown as NativeRootExecutionOperations,
        {} as unknown as NativeAgentRegistry, {} as unknown as NativeActiveSessionOperations, async () => {},
        { pollMs: 100, runTimeoutMs: 1000, maxConcurrent: 1, historyLimit: 50, minEverySeconds: 300 }, () => {}))
        .toThrow(invalid.error)
    } finally { invalidStore.close() }
  }

  const undispatched = new NativeTaskSchedulerRegistry(new TaskStore(join(root, 'dispose-before-start.sqlite')),
    {} as unknown as NativeRootExecutionOperations, {} as unknown as NativeAgentRegistry,
    {} as unknown as NativeActiveSessionOperations, async () => {},
    { pollMs: 100, runTimeoutMs: 1000, maxConcurrent: 1, historyLimit: 50, minEverySeconds: 300 }, () => {})
  const disposal = undispatched.dispose()
  expect(undispatched.dispose()).toBe(disposal)
  await disposal

  store = new TaskStore(taskPath)
  store.change('task-owner', stalePlan.id, 'deleted')
  const resumedAt = Date.now() - 1000
  store.create('restart-owner', { ...plan, at: new Date(resumedAt).toISOString() }, resumedAt - 1, 300)
  store.close()

  const state = await fixture([(options) => {
    expect((options.tools ?? []).some(tool => tool.name === 'task_schedule')).toBe(false)
    expect(JSON.stringify(options.messages)).toContain('Check persisted work after restart.')
    return textResponse('Restarted scheduled work finished.')
  }], root, true, 'low', 128)
  try {
    const reader = new TaskStore(join(root, 'tasks.sqlite'))
    try {
      await vi.waitFor(() => { expect(reader.runs()[0]?.state, reader.runs()[0]?.detail).toBe('completed') })
      expect(reader.tasks().find(task => task.ownerSessionId === 'restart-owner')).toMatchObject({
        nativeRoute: 'root', nextAt: null,
        nativeConfiguration: { builtinTools: true, reasoningEffort: 'low', maxTokens: 128 },
      })
      expect(reader.tasks().find(task => task.id === staleDeleted.id)?.state).toBe('deleted')
      const run = reader.runs()[0]!
      expect(run.sessionId).not.toBeNull()
      const writer = await state.storage.open(SessionId(run.sessionId!), 'read')
      try {
        expect(writer.header.parentSession).toBeUndefined()
        const events = (await writer.read()).events
        expect(JSON.stringify(events)).toContain('Check persisted work after restart.')
        expect(events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { reason: { kind: 'completed' } } }])
        expect(events.map(event => event.seq)).toEqual(events.map((_event, index) => index))
      } finally { await writer.close() }
    } finally { reader.close() }
    expect(state.model.requests).toHaveLength(1)
  } finally {
    await state.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('executes a due persisted plan through an independent root with durable settlement and no recursive management', async () => {
  const state = await fixture([(options) => {
    expect((options.tools ?? []).some(tool => tool.name === 'task_schedule')).toBe(false)
    expect(JSON.stringify(options.messages)).toContain('Check persisted work.')
    return textResponse('Scheduled work finished.')
  }])
  const id = SessionId('task-owner')
  let taskId: TaskId | undefined
  try {
    await state.app.executeSessionOperation({ id, resume: false }, async (owner, signal) => {
      const task = state.schedules.create(owner, { title: 'Check', prompt: 'Check persisted work.',
        at: new Date(Date.now() + 200).toISOString() }, signal)
      taskId = task.id
      expect(task.nativeRoute).toBe('root')
      expect(task.nativeConfiguration).toMatchObject({ builtinTools: true })
      expect(task.agentPreset).toBeUndefined()
      expect(task.permissionPreset).toBeUndefined()
      expect(state.schedules.list(owner)).toHaveLength(1)
    }, new AbortController().signal)
    const reader = new TaskStore(join(state.root, 'tasks.sqlite'))
    try {
      await vi.waitFor(() => { expect(reader.runs()[0]?.state, reader.runs()[0]?.detail).toBe('completed') })
      const run = reader.runs()[0]!
      expect(run.sessionId).not.toBe(id)
      const writer = await state.storage.open(SessionId(run.sessionId!), 'read')
      try {
        expect(writer.header.parentSession).toBeUndefined()
        const events = (await writer.read()).events
        const completed = events.findLast(event => event.type === 'turn/end')
        expect(completed).toMatchObject({ data: { reason: { kind: 'completed' } } })
        if (completed?.type !== 'turn/end') throw new Error('completed Session omitted its durable turn end')
        const blocked: SessionEvent<'turn/end'> = { ...completed, data: { ...completed.data, reason: { kind: 'blocked' } } }
        const failed: SessionEvent<'turn/end'> = { ...completed, data: { ...completed.data,
          reason: { kind: 'error', error: { message: 'mock provider failed', code: 'UNKNOWN' } } } }
        expect(events.map(event => event.seq)).toEqual(events.map((_event, index) => index))

        const routeId = brandString<NativeRootRouteId>('root')
        const configuration = reader.tasks()[0]?.nativeConfiguration
        if (configuration === undefined) throw new Error('native task omitted its selected configuration')
        const route: NativeRootRoute = { id: routeId, configuration }
        const outcomes: readonly (SessionEvent<'turn/end'> | undefined)[] = [blocked, failed, undefined]
        let nextOutcome = 0
        const rootOperations = {
          ready: async (_signal: AbortSignal) => {},
          resolve: (_id: NativeRootRouteId) => route,
          maintenance: async (_request: NativeRootSessionRequest,
            operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) =>
            operation({ agent: { id: NativeAgentId('classification'), scope: new NativeScope() } } as unknown as NativeActiveSessionOwner, signal),
          execute: async (request: NativeRootExecutionRequest) => {
            const outcome = outcomes[nextOutcome++]
            if (outcome !== undefined) request.onEvent?.(outcome)
            return { exitCode: 0 }
          },
        } as unknown as NativeRootExecutionOperations
        const classificationPath = join(state.root, 'classification.sqlite')
        const classificationStore = new TaskStore(classificationPath)
        const ids: TaskId[] = []
        const classificationAt = new Date(Date.now() + 300).toISOString()
        for (const title of ['Blocked', 'Failed', 'No settlement']) {
          ids.push(classificationStore.create('classification-owner', { title, prompt: `${title} work.`,
            workspace: route.configuration.cwd, nativeRoute: route.id, nativeConfiguration: route.configuration,
            provider: route.configuration.provider, model: route.configuration.model, at: classificationAt }, Date.now(), 300).id)
        }
        const classificationRegistry = new NativeTaskSchedulerRegistry(classificationStore, rootOperations,
          {} as unknown as NativeAgentRegistry, {} as unknown as NativeActiveSessionOperations, async () => {},
          { pollMs: 100, runTimeoutMs: 1000, maxConcurrent: 1, historyLimit: 50, minEverySeconds: 300 }, () => {})
        const classificationReader = new TaskStore(classificationPath)
        try {
          await classificationRegistry.start()
          await vi.waitFor(() => {
            const states = new Map(classificationReader.runs().map(run => [run.taskId, run.state]))
            expect(ids.map(taskId => states.get(taskId))).toEqual(['blocked', 'failed', 'failed'])
          }, { timeout: 5000 })
        } finally { await classificationRegistry.dispose(); classificationReader.close() }
      } finally { await writer.close() }
      expect(state.model.requests).toHaveLength(1)
    } finally { reader.close() }
    if (taskId === undefined) throw new Error('scheduled task was not created')
    await state.app.executeSessionOperation({ id, resume: true }, async (owner, signal) => {
      const history = state.schedules.history(owner, taskId)
      expect(history).toMatchObject([{ state: 'completed' }])
      expect(typeof history[0]?.sessionId).toBe('string')
      expect(state.schedules.history(owner)).toEqual(history)
      signal.throwIfAborted()
    }, new AbortController().signal)
  } finally { await state.close() }
})

it('persists owner management without model turns and publishes canonical root tool results', async () => {
  const state = await fixture([(options) => {
    expect(options.tools?.map(tool => tool.name)).toContain('task_schedule')
    return toolCallResponse('create-task', 'task_schedule', { action: 'create', title: 'Later', prompt: 'Inspect work.',
      at: new Date(Date.now() + 60000).toISOString() })
  }, textResponse('Plan saved.')])
  const id = SessionId('task-management')
  let errorReportingTaskId: TaskId | undefined
  try {
    await state.app.executeSessionOperation({ id, resume: false }, async (owner, signal) => {
      expect(state.scheduler.accepts(owner)).toBe(true)
      expect(state.scheduler.accepts({ ...owner, invocation: 'delegated' })).toBe(false)
      expect(() => state.schedules.create(owner, { title: 'Goal', prompt: 'Finish work.', kind: 'goal',
        completionCriteria: 'Verified', at: new Date(Date.now() + 60000).toISOString() }, signal)).toThrow('requires the Goal Provider batch')
      expect(() => state.schedules.create(owner, { title: 'Reminder', prompt: '提醒我晚上看报告。',
        at: new Date(Date.now() + 60000).toISOString() }, signal)).toThrow('does not support personal reminder modes')
      expect(() => state.schedules.create(owner, { title: 'Past countdown', prompt: 'Check work.',
        at: new Date(Date.now() - 1000).toISOString(), delaySeconds: 60, delayFromAt: true }, signal))
        .toThrow('Countdown start must not be in the past')
      const target = new Date(Date.now() + 60000).toISOString()
      const task = state.schedules.create(owner, { title: 'Future', prompt: 'Check work.', at: target,
        delaySeconds: 60, delayFromAt: true }, signal)
      expect((await state.schedules.change(owner, task.id, 'paused', signal)).state).toBe('paused')
      expect((await state.schedules.change(owner, task.id, 'active', signal)).state).toBe('active')
      expect((await state.schedules.change(owner, task.id, 'deleted', signal)).state).toBe('deleted')
      expect(Date.parse(task.at)).toBeGreaterThan(Date.parse(target))
      expect(task.countdownStartedAt).toBe(target)
      expect(state.schedules.list(owner)).toHaveLength(0)
      expect(state.schedules.history(owner, task.id)).toHaveLength(0)
      expect(() => state.schedules.history(owner, brandString<TaskId>('missing'))).toThrow('task not found in this Session')

      await expect(invokeTaskTool(state, owner, signal, { action: 'list' }, false))
        .rejects.toThrow('Task management requires exact initiating Agent')
      const legacyStore = new TaskStore(join(state.root, 'tasks.sqlite'))
      const legacyGoal = legacyStore.create(owner.session.id, { title: 'Unsupported Goal', prompt: 'Finish work.',
        workspace: state.root, agentPreset: 'standard', permissionPreset: 'read-only', provider: 'mock', model: 'parent',
        kind: 'goal', completionCriteria: 'verified', at: new Date(Date.now() + 60 * 60_000).toISOString() }, Date.now(), 300)
      legacyStore.close()
      await expect(state.schedules.change(owner, legacyGoal.id, 'deleted', signal))
        .rejects.toThrow('Native Goal scheduling requires the Goal Provider batch')
      await expect(invokeTaskTool(state, owner, signal, { action: 'create' })).rejects.toThrow()
      const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
      const toolTask = JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'create', title: 'Tool plan',
        prompt: 'Inspect the project.', after_seconds: 60, end_at: endAt, every_seconds: 300 }))) as { id: string }
      errorReportingTaskId = brandString<TaskId>(toolTask.id)
      await invokeTaskTool(state, owner, signal, { action: 'create', title: 'Single shot', prompt: 'Inspect once.',
        at: new Date(Date.now() + 60_000).toISOString() })
      expect(JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'list' }))))
        .toContainEqual(expect.objectContaining({ id: toolTask.id, nativeRoute: 'root' }))
      expect(JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'history', id: toolTask.id })))).toEqual([])
      expect(JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'history' })))).toEqual([])
      await expect(invokeTaskTool(state, owner, signal, { action: 'pause' })).rejects.toThrow('id is required')
      expect(JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'pause', id: toolTask.id }))))
        .toMatchObject({ state: 'paused' })
      expect(JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'resume', id: toolTask.id }))))
        .toMatchObject({ state: 'active' })
      expect(JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'delete', id: toolTask.id }))))
        .toMatchObject({ state: 'deleted' })

      const delegated = await syntheticOwner(state, 'task-schedule-delegated', owner.agent.scope, 'delegated')
      try {
        expect(state.tools.schemas(delegated.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(false)
        await expect(invokeTaskTool(state, delegated.owner, signal, { action: 'list' }))
          .rejects.toThrow('unknown tool task_schedule')
        expect(() => state.schedules.list(delegated.owner))
          .toThrow('Native task management requires the exact interactive root owner')
      } finally { await delegated.dispose() }

      const isolatedDelegated = await syntheticOwner(state, 'task-schedule-isolated', state.scope, 'delegated')
      try { expect(state.tools.schemas(isolatedDelegated.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(false) }
      finally { await isolatedDelegated.dispose() }

      const detached = await syntheticOwner(state, 'task-schedule-detached', owner.agent.scope, 'root')
      try {
        expect(state.tools.schemas(detached.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(true)
        await detached.detach()
        await expect(invokeTaskTool(state, detached.owner, signal, { action: 'list' }))
          .rejects.toThrow('Task management requires an attached Session')
      } finally { await detached.dispose() }
    }, new AbortController().signal)
    expect(state.model.requests).toHaveLength(0)
    expect(await state.app.executeRootTurn({ id: SessionId('task-tool-owner'), resume: false,
      message: createUserMessage({ content: [{ type: 'text', text: 'Schedule an explicit future inspection.' }],
        source: { kind: 'user' } }) }, new AbortController().signal)).toMatchObject({ answer: 'Plan saved.' })
    const writer = await state.storage.open(SessionId('task-tool-owner'), 'read')
    try {
      const events = (await writer.read()).events
      expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(JSON.stringify(events.find(event => event.type === 'tool/result'))).toContain('nativeRoute')
    } finally { await writer.close() }
    expect(state.model.requests).toHaveLength(2)
    if (errorReportingTaskId === undefined) throw new Error('task plan was not created for error-reporting check')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const database = new DatabaseSync(join(state.root, 'tasks.sqlite'))
      try { database.prepare('UPDATE tasks SET body=? WHERE id=?').run('{', errorReportingTaskId) }
      finally { database.close() }
      await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('native-task-scheduler:')) })
    } finally { warning.mockRestore() }
  } finally { await state.close() }
})

it('reattaches management to the same live root on Host replacement and keeps child and scheduled Agents denied', async () => {
  const state = await fixture([(options) => {
    expect(options.tools?.some(tool => tool.name === 'task_schedule')).toBe(false)
    expect(JSON.stringify(options.messages)).toContain('Scheduled after reload.')
    return textResponse('Scheduled work after reload finished.')
  }])
  const operationReady = Promise.withResolvers<undefined>()
  const operationRelease = Promise.withResolvers<undefined>()
  let owner: NativeActiveSessionOwner | undefined
  let signal: AbortSignal | undefined
  let delegated: Awaited<ReturnType<typeof syntheticOwner>> | undefined
  const operation = state.app.executeSessionOperation({ id: SessionId('task-hmr-owner'), resume: false }, async (attached, currentSignal) => {
    owner = attached
    signal = currentSignal
    operationReady.resolve(undefined)
    await operationRelease.promise
  }, new AbortController().signal)
  try {
    await operationReady.promise
    if (owner === undefined || signal === undefined) throw new Error('interactive owner did not attach')
    const exactOwner = owner
    delegated = await syntheticOwner(state, 'task-hmr-delegated', owner.agent.scope, 'delegated')
    expect(state.tools.schemas(owner.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(true)
    const previousScheduler = state.scheduler
    await state.replaceScheduler(200)
    expect(state.scheduler).not.toBe(previousScheduler)
    expect(state.activeSessions.owner(owner.agent, owner.session)).toBe(exactOwner)
    expect(state.tools.schemas(owner.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(true)
    expect(state.tools.schemas(delegated.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(false)
    await expect(invokeTaskTool(state, delegated.owner, signal, { action: 'list' })).rejects.toThrow('unknown tool task_schedule')

    const created = JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'create', title: 'After reload',
      prompt: 'Scheduled after reload.', at: new Date(Date.now() + 500).toISOString() }))) as { id: string }
    expect(JSON.parse(toolText(await invokeTaskTool(state, owner, signal, { action: 'list' }))))
      .toContainEqual(expect.objectContaining({ id: created.id, nativeRoute: 'root' }))
    await vi.waitFor(() => { expect(state.schedules.history(owner!, brandString<TaskId>(created.id)))
      .toMatchObject([{ state: 'completed' }]) }, { timeout: 10_000, interval: 50 })
    expect(state.model.requests).toHaveLength(1)
    expect(state.activeSessions.owner(owner.agent, owner.session)).toBe(exactOwner)
  } finally {
    try { await delegated?.dispose() }
    finally {
      operationRelease.resolve(undefined)
      try { await operation } finally { await state.close() }
    }
  }
})

it('persists scheduled origin before maintenance publishes the owner and restores the denial after replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-task-scheduler-origin-'))
  const id = SessionId('task-scheduler-origin')
  const operationReady = Promise.withResolvers<NativeActiveSessionOwner>()
  const operationRelease = Promise.withResolvers<undefined>()
  let state: Awaited<ReturnType<typeof fixture>> | undefined
  let maintenance: Promise<{ readonly error?: unknown }> | undefined
  try {
    state = await fixture([], root)
    maintenance = state.app.executeSessionOperation({ id, resume: false, rootOrigin: 'scheduled' }, async (owner, signal) => {
      signal.throwIfAborted()
      operationReady.resolve(owner)
      await operationRelease.promise
    }, new AbortController().signal).then(() => ({}), (error: unknown) => ({ error }))
    const owner = await Promise.race([
      operationReady.promise,
      maintenance.then((result) => {
        if (result.error !== undefined) throw result.error
        throw new Error('scheduled maintenance ended before its owner callback')
      }),
    ])
    expect(owner.rootOrigin).toBe('scheduled')
    expect(state.scheduler.accepts(owner)).toBe(false)
    expect(state.tools.schemas(owner.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(false)
    expect(owner.session.snapshotEvents()).toContainEqual(expect.objectContaining({
      type: 'session/root-origin', data: { origin: 'scheduled' }, ignorable: true,
    }))
    expect(owner.session.snapshotEvents().some(event => event.type === 'user/message'
      || event.type === 'agent/inbox/spliced' && event.data.inserted.length > 0)).toBe(false)

    const previous = state.scheduler
    await state.replaceScheduler(200)
    expect(state.scheduler).not.toBe(previous)
    expect(state.activeSessions.owner(owner.agent, owner.session)).toBe(owner)
    expect(state.scheduler.accepts(owner)).toBe(false)
    expect(state.tools.schemas(owner.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(false)

    operationRelease.resolve(undefined)
    const maintenanceResult = await maintenance
    if (maintenanceResult.error !== undefined) throw maintenanceResult.error
    const reader = await state.storage.open(id, 'read')
    try {
      const stored = (await reader.read()).events
      expect(stored.filter(event => event.type === 'session/root-origin')).toEqual([
        expect.objectContaining({ data: { origin: 'scheduled' }, ignorable: true }),
      ])
      expect(stored.some(event => event.type === 'user/message'
        || event.type === 'agent/inbox/spliced' && event.data.inserted.length > 0)).toBe(false)
    } finally { await reader.close() }
    expect(state.model.requests).toHaveLength(0)
    await state.close()
    state = undefined

    let restoredOwner: NativeActiveSessionOwner | undefined
    state = await fixture([(options) => {
      expect(options.tools?.some(tool => tool.name === 'task_schedule')).toBe(false)
      return textResponse('Restored scheduled work finished.')
    }], root)
    const releaseObservation = state.activeSessions.onAttached(async (owner) => {
      if (owner.session.id === id) restoredOwner = owner
    })
    try {
      const result = await state.app.executeRootTurn({ id, resume: true,
        message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue this scheduled work.' }] }),
      }, new AbortController().signal)
      expect(result.answer).toBe('Restored scheduled work finished.')
    } finally { await releaseObservation() }
    if (restoredOwner === undefined) throw new Error('restored scheduled Session did not publish its active owner')
    expect(restoredOwner.rootOrigin).toBe('scheduled')
    expect(state.scheduler.accepts(restoredOwner)).toBe(false)
    expect(state.tools.schemas(restoredOwner.agent.scope).some(tool => tool.name === 'task_schedule')).toBe(false)
    expect(state.model.requests).toHaveLength(1)
  } finally {
    operationRelease.resolve(undefined)
    try {
      if (maintenance !== undefined) {
        const result = await maintenance
        if (result.error !== undefined) throw result.error
      }
    } finally {
      try { await state?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  }
})

it('cancels and drains an admitted root execution on Provider shutdown before recording interruption', async () => {
  const state = await fixture(['hang-slow'])
  const id = SessionId('task-cancel-owner')
  const reader = new TaskStore(join(state.root, 'tasks.sqlite'))
  let activeOwner: NativeActiveSessionOwner | undefined
  try {
    await state.app.executeSessionOperation({ id, resume: false }, async (owner, signal) => {
      activeOwner = owner
      state.schedules.create(owner, { title: 'Cancel', prompt: 'Check ongoing work.',
        at: new Date(Date.now() + 150).toISOString() }, signal)
    }, new AbortController().signal)
    await vi.waitFor(() => { expect(state.model.requests).toHaveLength(1) })
    const disposal = state.scheduler.dispose()
    expect(state.scheduler.dispose()).toBe(disposal)
    await disposal
    if (activeOwner === undefined) throw new Error('task owner was not attached')
    expect(state.scheduler.accepts(activeOwner)).toBe(false)
    expect(reader.runs()[0]?.state).toBe('interrupted')
    expect(state.model.requests[0]?.signal?.aborted).toBe(true)
    expect(state.model.requests).toHaveLength(1)
    await state.host.stop()

    const root = await mkdtemp(join(tmpdir(), 'rsh-task-scheduler-startup-stop-'))
    const contextCancellation = new AbortController()
    contextCancellation.abort(new Error('Host stopped'))
    const disposers: Array<() => Promise<void>> = []
    const context = { scope: new NativeScope(), signal: contextCancellation.signal,
      require: (key: string) => key === 'rootExecution'
        ? { ready: () => Promise.reject(new Error('Host stopped before Program readiness')) }
        : key === 'activeSessions' ? { onAttached: () => () => Promise.resolve(), owners: () => [] } : {},
      provide: () => {}, own: (dispose: () => Promise<void>) => { disposers.push(dispose); return () => Promise.resolve() },
      effect: (dispose: () => Promise<void>) => { disposers.push(dispose); return () => Promise.resolve() },
      on: () => () => Promise.resolve(), optional: () => undefined, events: {}, groupInstallations: () => () => Promise.resolve(),
    } as unknown as NativeContext
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await nativeSchedulerPlugin.resolve({ path: join(root, 'tasks.sqlite') })(context)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(warning).not.toHaveBeenCalled()
      await Promise.all(disposers.map(dispose => dispose()))
    } finally {
      warning.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  } finally { reader.close(); await state.close() }
})
