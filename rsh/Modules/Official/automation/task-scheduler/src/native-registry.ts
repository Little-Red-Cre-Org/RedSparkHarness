/** Native task management and root execution over the shared SQLite plan authority. */
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgent, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner, NativeRootExecutionOperations, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import type { CreateTaskRequest } from './gui-types.ts'
import type { NativeTaskSchedulerOperations } from './native-types.ts'
import { SchedulerEngine } from './engine.ts'
import { TaskStore } from './store.ts'
import { delayedTime, isDirectReminder, validateTimingDescription } from './time.ts'
import type { SchedulerOptions, Task, TaskId } from './types.ts'

/** Native Provider keeps execution in the Program's selected root executor. */
export class NativeTaskSchedulerRegistry implements NativeTaskSchedulerOperations {
  private readonly engine: SchedulerEngine
  private closing = false
  private disposal: Promise<void> | undefined
  private readonly startupCancellation = new AbortController()
  private starting: Promise<void> | undefined
  private startupFailure: { readonly cause: unknown } | undefined
  constructor(private readonly store: TaskStore, private readonly roots: NativeRootExecutionOperations,
    private readonly agents: NativeAgentRegistry, private readonly owners: NativeActiveSessionOperations,
    private readonly excludeScheduled: (agent: NativeAgent) => Promise<void>, private readonly options: SchedulerOptions,
    report: (error: unknown) => void) {
    for (const task of store.tasks()) if (task.state !== 'deleted') this.validateRepresentation(task)
    this.engine = new SchedulerEngine(store, async (task, run, signal) => {
      const route = this.route(task)
      const id = SessionId(run.sessionId)
      await roots.maintenance({ route: route.id, id, resume: task.resumeSessionId !== undefined, rootOrigin: 'scheduled' }, async (owner, effective) => {
        effective.throwIfAborted()
        await this.excludeScheduled(owner.agent)
        effective.throwIfAborted()
      }, signal)
      let reason: string | undefined
      await roots.execute({ route: route.id, id, resume: true, rootOrigin: 'scheduled',
        message: createUserMessage({ content: [{ type: 'text', text:
          `[Scheduled task ${task.id}; occurrence ${new Date(run.scheduledAt).toISOString()}]\n`
          + 'The scheduled time has arrived. Execute now; prior relative delays have already elapsed.\n' + task.prompt }],
        source: { kind: 'plugin', plugin: 'task-scheduler' } }),
        onEvent: (event) => { if (event.type === 'turn/end') reason = event.data.reason.kind },
      }, signal)
      signal.throwIfAborted()
      return { sessionId: id, state: reason === 'completed' ? 'completed' : reason === 'blocked' ? 'blocked' : 'failed',
        detail: reason === 'completed' ? 'Agent turn completed; inspect its Session for verification evidence.'
          : `Agent turn did not complete: ${reason ?? 'no durable turn/end'}` }
    }, options, report)
  }
  /**
   * Wait for the actual selected Program executor before resolving stored routes and starting polling.
   * @returns memoized startup; cancellation or configuration failure starts no execution.
   */
  start(): Promise<void> {
    return this.starting ??= this.roots.ready(this.startupCancellation.signal).then(() => {
      this.startupCancellation.signal.throwIfAborted()
      for (const task of this.store.tasks()) if (task.state !== 'deleted') this.route(task)
      this.engine.start()
    }).catch((cause: unknown) => {
      this.startupFailure = { cause }
      throw cause
    })
  }
  /**
   * Test current management eligibility without creating execution authority.
   * @param owner - attached Program owner.
   * @returns whether the owner is an interactive root rather than delegated or scheduled execution.
   */
  accepts(owner: NativeActiveSessionOwner): boolean {
    return !this.closing && owner.invocation === 'root' && owner.rootOrigin !== 'scheduled'
      && this.agents.get(owner.agent.id) === owner.agent && this.owners.owner(owner.agent, owner.session) === owner
  }
  /** @inheritdoc */
  create(owner: NativeActiveSessionOwner, request: CreateTaskRequest, signal: AbortSignal): Task {
    this.assertOwner(owner)
    signal.throwIfAborted()
    if (isDirectReminder(request)) throw new Error('Native scheduled Agent work does not support personal reminder modes')
    if (request.kind === 'goal') throw new Error('Native Goal scheduling requires the Goal Provider batch')
    const route = this.roots.capture(owner)
    const now = Date.now()
    validateTimingDescription(request, now)
    const { delaySeconds, delayFromAt, ...input } = request
    const start = delaySeconds === undefined ? undefined : delayFromAt ? Date.parse(input.at) : now
    if (start !== undefined && (!Number.isFinite(start) || start < now)) throw new Error('Countdown start must not be in the past')
    if (delaySeconds !== undefined && start !== undefined) input.at = delayedTime(delaySeconds, start)
    return this.store.create(owner.session.id, { ...input, nativeRoute: route.id,
      nativeConfiguration: { ...route.configuration },
      workspace: route.configuration.cwd, provider: route.configuration.provider, model: route.configuration.model,
      ...start === undefined ? {} : { countdownStartedAt: new Date(start).toISOString() } }, now, this.options.minEverySeconds)
  }
  /** @inheritdoc */
  list(owner: NativeActiveSessionOwner): readonly Task[] {
    this.assertOwner(owner)
    return this.store.tasks().filter(task => task.ownerSessionId === owner.session.id && task.state !== 'deleted')
  }
  /** @inheritdoc */
  change(owner: NativeActiveSessionOwner, id: TaskId, state: Task['state'], signal: AbortSignal): Promise<Task> {
    this.assertOwner(owner)
    signal.throwIfAborted()
    const task = this.store.tasks().find(task => task.id === id && task.ownerSessionId === owner.session.id)
    if (task?.kind === 'goal') throw new Error('Native Goal scheduling requires the Goal Provider batch')
    return Promise.resolve(this.store.change(owner.session.id, id, state))
  }
  /** @inheritdoc */
  history(owner: NativeActiveSessionOwner, id?: TaskId) {
    this.assertOwner(owner)
    const plans = this.store.tasks().filter(task => task.ownerSessionId === owner.session.id)
    if (id !== undefined && !plans.some(task => task.id === id)) throw new Error('task not found in this Session')
    return this.store.runs().filter(run => plans.some(task => task.id === run.taskId) && (id === undefined || run.taskId === id))
      .slice(0, this.options.historyLimit)
  }
  /**
   * Cancel admission and drain active root execution before closing SQLite.
   * @returns memoized quiescent release without deleting plans or receipts.
   */
  dispose(): Promise<void> {
    this.closing = true
    if (this.disposal !== undefined) return this.disposal
    this.startupCancellation.abort(new Error('native task scheduler stopped before Program readiness'))
    return this.disposal = Promise.allSettled(this.starting === undefined ? [] : [this.starting])
      .then(() => this.engine.dispose())
  }
  private assertOwner(owner: NativeActiveSessionOwner): void {
    if (this.startupFailure !== undefined) {
      throw new Error('Native task scheduler startup failed', this.startupFailure)
    }
    if (!this.accepts(owner)) throw new Error('Native task management requires the exact interactive root owner')
  }
  private route(task: Task) {
    this.validateRepresentation(task)
    const route = this.roots.resolve(task.nativeRoute)
    const config = route.configuration
    const saved = task.nativeConfiguration
    if (saved === undefined || task.workspace !== config.cwd || task.provider !== config.provider || task.model !== config.model
      || saved.cwd !== config.cwd || saved.provider !== config.provider || saved.model !== config.model
      || saved.systemPrompt !== config.systemPrompt || saved.maxSteps !== config.maxSteps
      || saved.builtinTools !== config.builtinTools
      || saved.reasoningEffort !== config.reasoningEffort || saved.maxTokens !== config.maxTokens) {
      throw new Error('Persisted task configuration differs from the selected Program route')
    }
    return route
  }
  private validateRepresentation(task: Task): asserts task is Task & { nativeRoute: NativeRootRouteId } {
    if (task.nativeRoute === undefined || task.agentPreset !== undefined || task.permissionPreset !== undefined) {
      throw new Error('Native task scheduling cannot adopt compatibility presets')
    }
    if (isDirectReminder(task)) throw new Error('Native task scheduling cannot adopt personal reminder modes')
    if (task.kind === 'goal') throw new Error('Native Goal scheduling requires the Goal Provider batch')
    if (task.resumeSessionId !== undefined) throw new Error('Scheduled task cannot resume a previous execution Session')
  }
}
