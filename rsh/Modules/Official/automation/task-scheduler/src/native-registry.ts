/** Native task management and root execution over the shared SQLite plan authority. */
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgent, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner, NativeRootExecutionOperations, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import type { GoalRef, GoalView } from '@deepseek-ai/dsh-goal/types'
import type { NativeScheduledGoalAdmission, NativeScheduledGoalAdmissionLease, NativeScheduledGoalExecutor,
  NativeScheduledGoalHost } from '@deepseek-ai/dsh-goal/native'
import type { CreateTaskRequest } from './gui-types.ts'
import type { NativeTaskSchedulerOperations } from './native-types.ts'
import { SchedulerEngine } from './engine.ts'
import { TaskStore } from './store.ts'
import { delayedTime, validateTimingDescription } from './time.ts'
import type { ClaimedRun, SchedulerOptions, Task, TaskId } from './types.ts'
import { appendNativeReminderRecord } from './native-reminder.ts'

interface GoalExecutorRegistration {
  readonly executor: NativeScheduledGoalExecutor
  readonly calls: Set<Promise<unknown>>
  readonly admissions: Set<NativeScheduledGoalAdmission>
  active: boolean
  drain: Promise<void> | undefined
}

interface ScheduledGoalClaim {
  readonly task: Task
  readonly run: ClaimedRun
  readonly route: NativeRootRouteId
  readonly id: ReturnType<typeof SessionId>
  readonly owner: NativeActiveSessionOwner
  readonly root: NonNullable<NativeActiveSessionOwner['rootOperations']>
  readonly registration: GoalExecutorRegistration
  readonly resume: boolean
  state: 'issued' | 'redeeming' | 'redeemed' | 'released'
}

/** Native Provider keeps execution in the Program's selected root executor. */
export class NativeTaskSchedulerRegistry implements NativeTaskSchedulerOperations {
  private readonly engine: SchedulerEngine
  private closing = false
  private disposal: Promise<void> | undefined
  private readonly startupCancellation = new AbortController()
  private starting: Promise<void> | undefined
  private startupFailure: { readonly cause: unknown } | undefined
  private goalExecutor: GoalExecutorRegistration | undefined
  private readonly goalClaims = new WeakMap<NativeScheduledGoalAdmission, ScheduledGoalClaim>()
  private readonly scheduledGoalHost: NativeScheduledGoalHost
  constructor(private readonly store: TaskStore, private readonly roots: NativeRootExecutionOperations,
    private readonly agents: NativeAgentRegistry, private readonly owners: NativeActiveSessionOperations,
    private readonly excludeScheduled: (agent: NativeAgent) => Promise<void>, private readonly options: SchedulerOptions,
    report: (error: unknown) => void) {
    this.scheduledGoalHost = { authority: { redeem: (admission, owner, signal) => this.redeemGoalClaim(admission, owner, signal) },
      registerExecutor: executor => this.registerGoalExecutor(executor) }
    for (const task of store.tasks()) if (task.state !== 'deleted') this.validateRepresentation(task)
    this.engine = new SchedulerEngine(store, async (task, run, signal) => await this.execute(task, run, signal), options, report,
      async (task, run, signal) => await this.deliverReminder(task, run, signal),
      () => this.goalExecutor?.active === true && !this.closing)
  }
  /** Scheduler-owned Host port; only the installed Goal driver receives this capability. */
  get nativeScheduledGoalHost(): NativeScheduledGoalHost { return this.scheduledGoalHost }
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
    if (request.kind === 'goal' && this.goalExecutor?.active !== true) throw new Error('Native Goal scheduling requires the Goal Provider and driver')
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
    const tasks = this.store.tasks().filter(task => task.ownerSessionId === owner.session.id && task.state !== 'deleted')
    for (const task of tasks) this.validateRepresentation(task)
    return tasks
  }
  /** @inheritdoc */
  async change(owner: NativeActiveSessionOwner, id: TaskId, state: Task['state'], signal: AbortSignal): Promise<Task> {
    this.assertOwner(owner)
    signal.throwIfAborted()
    const task = this.store.tasks().find(task => task.id === id && task.ownerSessionId === owner.session.id)
    if (task !== undefined) this.validateRepresentation(task)
    if (task?.kind === 'goal' && state === 'active' && this.goalExecutor?.active !== true) {
      throw new Error('Native Goal scheduling requires the Goal Provider and driver')
    }
    if (task?.kind === 'goal' && state === 'active' && !await this.isDirectHumanTurn(owner, signal)) {
      throw new Error('Resuming a Goal task requires an explicit direct human turn')
    }
    if (task?.kind === 'goal' && state === 'paused') await this.pauseActiveGoal(task, signal)
    return this.store.change(owner.session.id, id, state)
  }
  /** @inheritdoc */
  history(owner: NativeActiveSessionOwner, id?: TaskId) {
    this.assertOwner(owner)
    const plans = this.store.tasks().filter(task => task.ownerSessionId === owner.session.id)
    for (const task of plans) this.validateRepresentation(task)
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
      .then(async () => {
        await this.engine.dispose()
        if (this.goalExecutor !== undefined) await this.releaseGoalExecutor(this.goalExecutor)
      })
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
    if (task.kind === 'goal' && !task.completionCriteria) {
      throw new Error('Native Goal task requires its persisted completion criteria')
    }
    if (task.resumeSessionId !== undefined && task.kind !== 'goal') {
      throw new Error('Only a Goal task can resume its previous execution Session')
    }
  }

  private async deliverReminder(task: Task, run: ClaimedRun, signal: AbortSignal): Promise<string> {
    const route = this.route(task)
    const id = SessionId(task.ownerSessionId)
    await this.roots.maintenance({ route: route.id, id, resume: true }, async (owner, effective) => {
      this.assertRootOwner(owner, route.id, id, false)
      effective.throwIfAborted()
      await appendNativeReminderRecord(owner, task, { ...run, sessionId: id, state: 'completed', finishedAt: Date.now() }, effective)
    }, signal)
    this.store.bindReminderSession(task.id, id)
    return id
  }

  private async execute(task: Task, run: ClaimedRun, signal: AbortSignal) {
    const route = this.route(task)
    const id = SessionId(run.sessionId)
    if (task.kind === 'goal') return await this.executeGoal(task, run, route.id, id, signal)
    await this.roots.maintenance({ route: route.id, id, resume: task.resumeSessionId !== undefined, rootOrigin: 'scheduled' }, async (owner, effective) => {
      this.assertRootOwner(owner, route.id, id, true)
      effective.throwIfAborted()
      await this.excludeScheduled(owner.agent)
      effective.throwIfAborted()
    }, signal)
    let reason: string | undefined
    await this.roots.execute({ route: route.id, id, resume: true, rootOrigin: 'scheduled',
      message: createUserMessage({ content: [{ type: 'text', text:
        `[Scheduled task ${task.id}; occurrence ${new Date(run.scheduledAt).toISOString()}]\n`
        + 'The scheduled time has arrived. Execute now; prior relative delays have already elapsed.\n' + task.prompt }],
      source: { kind: 'plugin', plugin: 'task-scheduler' } }),
      onEvent: (event) => { if (event.type === 'turn/end') reason = event.data.reason.kind },
    }, signal)
    signal.throwIfAborted()
    return { sessionId: id, state: reason === 'completed' ? 'completed' as const : reason === 'blocked' ? 'blocked' as const : 'failed' as const,
      detail: reason === 'completed' ? 'Agent turn completed; inspect its Session for verification evidence.'
        : `Agent turn did not complete: ${reason ?? 'no durable turn/end'}` }
  }

  private async executeGoal(task: Task, run: ClaimedRun, route: NativeRootRouteId, id: ReturnType<typeof SessionId>, signal: AbortSignal) {
    const registration = this.goalExecutor
    if (registration?.active !== true || !task.completionCriteria) {
      throw new Error('Native Goal task is missing its Goal Provider, driver, or completion criteria')
    }
    let admittedGoal: GoalView | undefined
    await this.roots.maintenance({ route, id, resume: task.resumeSessionId !== undefined, rootOrigin: 'scheduled' }, async (owner, effective) => {
      this.assertRootOwner(owner, route, id, true)
      await this.excludeScheduled(owner.agent)
      effective.throwIfAborted()
      const admission = this.issueGoalClaim(task, run, route, id, owner, registration)
      try {
        if (task.resumeSessionId === undefined) {
          const objective = `${task.prompt}\n\nCompletion criteria:\n${task.completionCriteria}`
          admittedGoal = await this.invokeGoalExecutor(registration, () => registration.executor.startScheduled(owner,
            { objective, maxGoalRounds: task.maxGoalRounds ?? 10 }, admission, effective))
        } else {
          const existing = registration.executor.get(owner)
          if (existing === undefined || existing.phase === 'complete') throw new Error('The unfinished Goal was not restored on its admitted Session')
          const ref: GoalRef = { id: existing.id, revision: existing.revision }
          admittedGoal = await this.invokeGoalExecutor(registration, () => registration.executor.resumeScheduled(owner, ref,
            task.maxGoalRounds ?? 10, admission, effective))
        }
      } finally { this.revokeGoalClaim(admission) }
    }, signal)
    signal.throwIfAborted()
    if (admittedGoal === undefined) throw new Error('Scheduled Goal admission did not return its durable Goal')
    const settlement = await this.roots.settle({ route, id }, signal)
    signal.throwIfAborted()
    if (settlement === undefined) return { sessionId: id, state: 'blocked' as const, detail: 'Goal root settled without an admitted turn.' }
    let finalGoal: GoalView | undefined
    let lastReason: string | undefined
    await this.roots.maintenance({ route, id, resume: true, rootOrigin: 'scheduled' }, async (owner, effective) => {
      this.assertRootOwner(owner, route, id, true)
      if (!registration.active || this.goalExecutor !== registration) throw new Error('Native Goal driver was released before settlement')
      finalGoal = registration.executor.get(owner)
      const events = await owner.readEvents({ signal: effective })
      lastReason = events.findLast(event => event.type === 'turn/end')?.data.reason.kind
    }, signal)
    if (finalGoal === undefined) throw new Error('Goal state disappeared after its root settled')
    if (finalGoal.phase === 'complete' && finalGoal.roundsStarted > admittedGoal.roundsStarted
      && settlement.exitCode === 0 && lastReason === 'completed') {
      return { sessionId: id, state: 'completed' as const,
        detail: 'Goal completed and its root turn settled; inspect the Session for evidence.' }
    }
    return { sessionId: id, state: 'blocked' as const,
      detail: `Goal root settled without durable completion (phase=${finalGoal.phase}, rounds=${finalGoal.roundsStarted}, turn=${lastReason ?? 'none'}).` }
  }

  private assertRootOwner(owner: NativeActiveSessionOwner, route: NativeRootRouteId,
    id: ReturnType<typeof SessionId>, scheduled: boolean): void {
    if (owner.session.id !== id || owner.invocation !== 'root' || (owner.rootOrigin === 'scheduled') !== scheduled
      || this.agents.get(owner.agent.id) !== owner.agent || this.owners.owner(owner.agent, owner.session) !== owner
      || this.roots.capture(owner).id !== route) {
      throw new Error('Scheduled operation requires the exact attached root Agent, route and origin')
    }
  }

  private issueGoalClaim(task: Task, run: ClaimedRun, route: NativeRootRouteId, id: ReturnType<typeof SessionId>,
    owner: NativeActiveSessionOwner, registration: GoalExecutorRegistration): NativeScheduledGoalAdmission {
    const root = owner.rootOperations
    if (root === undefined || !registration.active || this.goalExecutor !== registration) {
      throw new Error('Scheduled Goal claim requires the selected active scheduler and root epoch')
    }
    const admission = Object.freeze({}) as NativeScheduledGoalAdmission
    this.goalClaims.set(admission, { task, run, route, id, owner, root, registration,
      resume: task.resumeSessionId !== undefined, state: 'issued' })
    registration.admissions.add(admission)
    return admission
  }

  private redeemGoalClaim(admission: NativeScheduledGoalAdmission, owner: NativeActiveSessionOwner,
    signal: AbortSignal): Promise<NativeScheduledGoalAdmissionLease> {
    const claim = this.goalClaims.get(admission)
    if (claim === undefined || claim.state !== 'issued') {
      return Promise.reject(new Error('Scheduled Goal claim was not freshly issued by this scheduler'))
    }
    claim.state = 'redeeming'
    return Promise.resolve().then(() => {
      this.verifyGoalClaim(claim, owner, signal, 'redeeming')
      claim.state = 'redeemed'
      let released = false
      return { verify: (currentOwner: NativeActiveSessionOwner, currentSignal: AbortSignal) => Promise.resolve().then(() => {
        if (released || claim.state !== 'redeemed') throw new Error('Scheduled Goal claim was released or replayed')
        this.verifyGoalClaim(claim, currentOwner, currentSignal, 'redeemed')
      }), release: () => {
        if (released) return
        released = true
        this.revokeGoalClaim(admission)
      } }
    }).catch((failure: unknown) => {
      this.revokeGoalClaim(admission)
      throw failure
    })
  }

  private verifyGoalClaim(claim: ScheduledGoalClaim, owner: NativeActiveSessionOwner,
    signal: AbortSignal, state: 'redeeming' | 'redeemed'): void {
    signal.throwIfAborted()
    const { task, run, route, id, registration } = claim
    if (claim.state !== state || !registration.active || this.goalExecutor !== registration || this.closing
      || owner !== claim.owner || owner.rootOperations !== claim.root || claim.root.signal.aborted) {
      throw new Error('Scheduled Goal claim no longer owns its exact active root epoch')
    }
    const currentTask = this.store.tasks().find(candidate => candidate.id === task.id)
    const currentRun = this.store.runs().find(candidate => candidate.id === run.id)
    if (currentTask?.kind !== 'goal' || currentTask.state !== 'active' || currentTask.ownerSessionId !== task.ownerSessionId
      || currentTask.nativeRoute !== route || currentTask.prompt !== task.prompt
      || currentTask.completionCriteria !== task.completionCriteria
      || (claim.resume ? currentTask.resumeSessionId !== id : currentTask.resumeSessionId !== undefined)
      || currentRun?.taskId !== task.id || currentRun.state !== 'running' || currentRun.sessionId !== id
      || currentRun.deadline <= Date.now()) {
      throw new Error('Scheduled Goal claim no longer has its exact durable running task receipt')
    }
    this.assertRootOwner(owner, route, id, true)
  }

  private revokeGoalClaim(admission: NativeScheduledGoalAdmission): void {
    const claim = this.goalClaims.get(admission)
    if (claim === undefined) return
    claim.state = 'released'
    claim.registration.admissions.delete(admission)
    this.goalClaims.delete(admission)
  }

  private registerGoalExecutor(executor: NativeScheduledGoalExecutor): () => Promise<void> {
    if (this.closing || this.goalExecutor !== undefined) throw new Error('Native Goal driver executor is already registered or scheduler is stopping')
    const registration: GoalExecutorRegistration = { executor, calls: new Set(), admissions: new Set(), active: true, drain: undefined }
    this.goalExecutor = registration
    return () => this.releaseGoalExecutor(registration)
  }

  private releaseGoalExecutor(registration: GoalExecutorRegistration): Promise<void> {
    if (registration.drain !== undefined) return registration.drain
    registration.active = false
    for (const admission of registration.admissions) this.revokeGoalClaim(admission)
    return registration.drain = (async () => {
      await Promise.allSettled([...registration.calls])
      if (this.goalExecutor === registration) this.goalExecutor = undefined
    })()
  }

  private async invokeGoalExecutor<T>(registration: GoalExecutorRegistration, operation: () => Promise<T>): Promise<T> {
    if (!registration.active || this.goalExecutor !== registration || this.closing) {
      throw new Error('Native Goal driver executor is not active')
    }
    const call = Promise.resolve().then(operation)
    registration.calls.add(call)
    try { return await call } finally { registration.calls.delete(call) }
  }

  private async pauseActiveGoal(task: Task, signal: AbortSignal): Promise<void> {
    const run = this.store.runs().find(candidate => candidate.taskId === task.id && candidate.state === 'running')
    const registration = this.goalExecutor
    if (run === undefined || run.sessionId === null || registration?.active !== true) return
    const route = this.route(task)
    const id = SessionId(run.sessionId)
    const owner = this.owners.owners().find(candidate => candidate.session.id === id)
    if (owner === undefined) return
    this.assertRootOwner(owner, route.id, id, true)
    const goal = registration.executor.get(owner)
    if (goal?.phase === 'active') await this.invokeGoalExecutor(registration,
      () => registration.executor.pause(owner, { id: goal.id, revision: goal.revision }, signal))
    signal.throwIfAborted()
  }

  private async isDirectHumanTurn(owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<boolean> {
    const events = await owner.readEvents({ signal })
    signal.throwIfAborted()
    const start = events.findLastIndex(event => event.type === 'turn/start')
    return start >= 0 && !events.slice(start).some(event => event.type === 'turn/end')
      && events.slice(start + 1).some(event => event.type === 'user/message' && event.data.source.kind === 'user')
  }
}
