/** Native same-session Goal state over the selected Program's sole Session writer. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SessionSeq } from '@deepseek-ai/dsh-session/native'
import type { NativeAgent, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { applyGoalEvent, emptyGoalFoldState, type GoalFoldState } from './fold.ts'
import type { FoldedGoal, GoalChangeMeta, GoalOperation } from './facts.ts'
import { GOAL_CHANGE_VERSION, GoalError, GoalId } from './runtime.ts'
import { assertGoalCreationReference, resolveBlockReason, resolveCreateGoal, resolveMaxGoalRounds, resolveObjective } from './requests.ts'
import type { CreateGoalRequest, EditGoalRequest, GoalActivation, GoalBlockReason, GoalPhase, GoalRef, GoalSnapshot, GoalView } from './types.ts'

export type * from './types.ts'
export type * from './facts.ts'
export { GOAL_CHANGE_VERSION, GoalError, GoalId } from './runtime.ts'

const Configuration = z.object({ defaultMaxGoalRounds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(256) }).strict()
/** Explicit deployment default for same-session continuation rounds. */
export type NativeGoalConfig = z.infer<typeof Configuration>
/**
 * Resolve Goal deployment configuration.
 * @param input - profile JSON.
 * @returns validated defaults.
 */
export function resolveNativeGoalConfig(input: unknown): NativeGoalConfig { return Configuration.parse(input ?? {}) }

interface OwnerState {
  readonly owner: NativeActiveSessionOwner
  activation: GoalActivation
  releaseRetain: (() => void) | undefined
  mutation: Promise<void>
  readonly fold: GoalFoldState
  stopEvents: () => void
  readonly pendingChanges: Set<SessionSeq>
}

/** Definition consumed by Goal tools and the same-session continuation driver. */
export interface NativeGoalOperations {
  /**
 * Read exact live Goal state.
 * @param agent - original owning Agent.
 * @returns detached current view.
 */
  get(agent: NativeAgent): GoalView | undefined
  /**
 * Remove automatic authority without a durable phase change.
 * @param agent - original Agent.
 * @returns disarmed view.
 */
  disarm(agent: NativeAgent): GoalView | undefined
  /**
 * Create and arm a Goal.
 * @param agent - original Agent.
 * @param request - creation fields and optional observed Goal reference.
 * @returns durable view.
 */
  create(agent: NativeAgent, request: CreateGoalRequest): Promise<GoalView>
  /**
 * Edit a current revision.
 * @param agent - original Agent.
 * @param ref - CAS revision.
 * @param request - edits.
 * @returns durable view.
 */
  edit(agent: NativeAgent, ref: GoalRef, request: EditGoalRequest): Promise<GoalView>
  /**
 * Pause and disarm.
 * @param agent - original Agent.
 * @param ref - CAS revision.
 * @returns durable view.
 */
  pause(agent: NativeAgent, ref: GoalRef): Promise<GoalView>
  /**
 * Resume and arm with remaining rounds.
 * @param agent - original Agent.
 * @param ref - CAS revision.
 * @returns durable view.
 */
  resume(agent: NativeAgent, ref: GoalRef): Promise<GoalView>
  /**
 * Complete and disarm.
 * @param agent - original Agent.
 * @param ref - CAS revision.
 * @returns durable view.
 */
  complete(agent: NativeAgent, ref: GoalRef): Promise<GoalView>
  /**
 * Block and disarm.
 * @param agent - original Agent.
 * @param ref - CAS revision.
 * @param reason - explanation.
 * @returns durable view.
 */
  block(agent: NativeAgent, ref: GoalRef, reason: GoalBlockReason): Promise<GoalView>
  /**
 * Clear with a durable tombstone.
 * @param agent - original Agent.
 * @param ref - CAS revision.
 * @returns next tombstone revision.
 */
  clear(agent: NativeAgent, ref: GoalRef): Promise<GoalRef>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { goals: NativeGoalOperations }
}

/** Event-sourced CAS mutations and process-local residency retention; no model execution or writer is acquired. */
export class NativeGoalRegistry implements NativeGoalOperations {
  private readonly states = new Map<NativeAgent, OwnerState>()
  private readonly releases: (() => Promise<void>)[]
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param agents - exact Agent authority.
   * @param sessions - selected active-owner registry.
   * @param config - resolved Goal defaults.
   */
  constructor(private readonly agents: NativeAgentRegistry, private readonly sessions: NativeActiveSessionOperations,
    private readonly config: NativeGoalConfig) {
    this.releases = [sessions.onAttached(async (owner) => {
      if (this.closing) throw new Error('native-goal: registry is closing')
      const state: OwnerState = { owner, activation: 'disarmed', releaseRetain: undefined, mutation: Promise.resolve(),
        fold: emptyGoalFoldState(), stopEvents: () => {}, pendingChanges: new Set() }
      const buffered: import('@deepseek-ai/dsh-session/native').SessionEvent[] = []
      let initialized = false
      state.stopEvents = owner.onEvent((event) => {
        if (initialized) {
          applyGoalEvent(state.fold, event)
          if (event.type === 'goal/change' && !state.pendingChanges.delete(event.seq)) this.setActivation(state, 'disarmed')
        }
        else buffered.push(event)
      })
      try {
        const events = await owner.readEvents()
        for (const event of events) applyGoalEvent(state.fold, event)
        const highWater = events.at(-1)?.seq ?? -1
        for (const event of buffered) if (event.seq > highWater) applyGoalEvent(state.fold, event)
        this.assertAccepting()
        initialized = true
        this.states.set(owner.agent, state)
      } catch (failure: unknown) { state.stopEvents(); throw failure }
    }), sessions.onDetached(async (owner) => {
      const state = this.states.get(owner.agent)
      if (state?.owner !== owner) return
      this.states.delete(owner.agent)
      this.setActivation(state, 'disarmed')
      await state.mutation
      state.stopEvents()
    })]
  }

  /** @inheritdoc */
  get(agent: NativeAgent): GoalView | undefined { const state = this.state(agent); return this.view(state, this.fold(state)) }
  /** @inheritdoc */
  disarm(agent: NativeAgent): GoalView | undefined {
    const state = this.state(agent)
    this.setActivation(state, 'disarmed')
    return this.view(state, this.fold(state))
  }
  /** @inheritdoc */
  create(agent: NativeAgent, request: CreateGoalRequest): Promise<GoalView> {
    const spec = resolveCreateGoal(request, this.config.defaultMaxGoalRounds)
    return this.mutate(agent, (state) => {
      const folded = this.fold(state)
      assertGoalCreationReference(spec.expectedRef, folded.goal)
      if (folded.goal !== undefined && folded.goal.phase !== 'complete') throw new GoalError('a current Goal already exists', 'GOAL_ALREADY_EXISTS')
      const now = Date.now()
      return this.commit(state, { kind: 'goal/change', version: GOAL_CHANGE_VERSION, operation: 'create',
        goal: { id: GoalId(`goal-${randomUUID()}`), revision: 1, objective: spec.objective, phase: 'active', maxGoalRounds: spec.maxGoalRounds },
        roundsStarted: 0, createdAt: now, updatedAt: now }, 'armed')
    })
  }
  /** @inheritdoc */
  edit(agent: NativeAgent, ref: GoalRef, request: EditGoalRequest): Promise<GoalView> {
    if (request.objective === undefined && request.maxGoalRounds === undefined) throw new GoalError('Goal edit needs fields', 'GOAL_INVALID_EDIT')
    return this.change(agent, ref, 'edit', undefined, goal => ({ ...goal,
      ...request.objective === undefined ? {} : { objective: resolveObjective(request.objective) },
      ...request.maxGoalRounds === undefined ? {} : { maxGoalRounds: resolveMaxGoalRounds(request.maxGoalRounds) } }))
  }
  /** @inheritdoc */
  pause(agent: NativeAgent, ref: GoalRef): Promise<GoalView> {
    return this.change(agent, ref, 'pause', 'disarmed', goal => this.phase(goal, ['active'], 'paused'))
  }
  /** @inheritdoc */
  resume(agent: NativeAgent, ref: GoalRef): Promise<GoalView> {
    return this.change(agent, ref, 'resume', 'armed', (goal, folded, state) => {
      if (goal.phase === 'active' && state.activation === 'armed') throw new GoalError('Goal is already armed', 'GOAL_INVALID_TRANSITION')
      if (folded.roundsStarted >= goal.maxGoalRounds) throw new GoalError('Goal round budget is exhausted', 'GOAL_INVALID_TRANSITION')
      return this.phase(goal, ['active', 'paused', 'blocked'], 'active')
    })
  }
  /** @inheritdoc */
  complete(agent: NativeAgent, ref: GoalRef): Promise<GoalView> {
    return this.change(agent, ref, 'complete', 'disarmed', goal => this.phase(goal, ['active', 'paused', 'blocked'], 'complete'))
  }
  /** @inheritdoc */
  block(agent: NativeAgent, ref: GoalRef, reason: GoalBlockReason): Promise<GoalView> {
    const resolved = resolveBlockReason(reason)
    return this.change(agent, ref, 'block', 'disarmed', goal => ({ ...this.phase(goal, ['active'], 'blocked'), blockedReason: resolved }))
  }
  /** @inheritdoc */
  clear(agent: NativeAgent, ref: GoalRef): Promise<GoalRef> {
    return this.mutate(agent, async (state) => {
      const folded = this.current(state, ref)
      const cleared = { id: folded.goal.id, revision: folded.goal.revision + 1 }
      const event = state.owner.append('goal/change', { kind: 'goal/change', version: GOAL_CHANGE_VERSION, operation: 'clear', cleared,
        clearedAt: this.time(folded) })
      state.pendingChanges.add(event.seq)
      this.setActivation(state, 'disarmed')
      await state.owner.flush()
      return cleared
    })
  }

  /**
 * Disarm and release every retained owner, then drain accepted mutations.
 * @returns memoized quiescent disposal.
 */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    for (const state of this.states.values()) this.setActivation(state, 'disarmed')
    return this.disposal = Promise.allSettled([...this.releases.map(release => release()),
      ...[...this.states.values()].map(state => state.mutation)]).then(() => {
      for (const state of this.states.values()) state.stopEvents()
      this.states.clear()
    })
  }

  private assertAccepting(): void {
    if (this.closing) throw new Error('native-goal: registry is closing')
  }
  private state(agent: NativeAgent): OwnerState {
    const state = this.states.get(agent)
    if (this.closing || state === undefined || this.agents.get(agent.id) !== agent
      || this.sessions.owner(agent, state.owner.session) !== state.owner) throw new GoalError('Goal Agent is not live', 'GOAL_AGENT_NOT_LIVE')
    return state
  }
  private fold(state: OwnerState): FoldedGoal {
    const folded = state.fold
    return { ...folded.goal === undefined ? {} : { goal: folded.goal }, roundsStarted: folded.roundsStarted,
      ...folded.createdAt === undefined ? {} : { createdAt: folded.createdAt },
      ...folded.updatedAt === undefined ? {} : { updatedAt: folded.updatedAt } }
  }
  private view(state: OwnerState, folded: FoldedGoal): GoalView | undefined {
    if (folded.goal === undefined) return undefined
    if (folded.createdAt === undefined || folded.updatedAt === undefined) throw new Error('native-goal: current Goal lacks durable timestamps')
    return { ...folded.goal, roundsStarted: folded.roundsStarted, createdAt: folded.createdAt, updatedAt: folded.updatedAt,
      activation: state.activation }
  }
  private current(state: OwnerState, ref: GoalRef): FoldedGoal & { goal: GoalSnapshot } {
    const folded = this.fold(state)
    if (folded.goal === undefined) throw new GoalError('no current Goal', 'GOAL_NOT_FOUND')
    if (folded.goal.id !== ref.id || folded.goal.revision !== ref.revision) throw new GoalError('stale Goal revision', 'GOAL_STALE_REVISION')
    return { ...folded, goal: folded.goal }
  }
  private mutate<T>(agent: NativeAgent, operation: (state: OwnerState) => Promise<T>): Promise<T> {
    const state = this.state(agent)
    const result = state.mutation.then(async () => {
      this.state(agent)
      try { await state.owner.flush() } catch (failure: unknown) { this.setActivation(state, 'disarmed'); throw failure }
      this.state(agent)
      return await operation(state)
    })
    state.mutation = result.then(() => {}, () => {})
    return result
  }
  private change(agent: NativeAgent, ref: GoalRef, operation: Exclude<GoalOperation, 'create' | 'clear'>,
    activation: GoalActivation | undefined,
    update: (goal: GoalSnapshot, folded: FoldedGoal, state: OwnerState) => GoalSnapshot): Promise<GoalView> {
    return this.mutate(agent, (state) => {
      const folded = this.current(state, ref)
      const goal = { ...update(folded.goal, folded, state), revision: folded.goal.revision + 1 }
      return this.commit(state, { kind: 'goal/change', version: GOAL_CHANGE_VERSION, operation, goal,
        roundsStarted: folded.roundsStarted, createdAt: this.createdAt(folded), updatedAt: this.time(folded) },
      activation ?? state.activation)
    })
  }
  private async commit(state: OwnerState, change: GoalChangeMeta, activation: GoalActivation): Promise<GoalView> {
    const event = state.owner.append('goal/change', change)
    state.pendingChanges.add(event.seq)
    this.setActivation(state, activation)
    try { await state.owner.flush() } catch (failure: unknown) { this.setActivation(state, 'disarmed'); throw failure }
    const view = this.view(state, this.fold(state))
    if (view === undefined) throw new Error('native-goal: committed mutation has no current Goal')
    return view
  }
  private setActivation(state: OwnerState, activation: GoalActivation): void {
    if (activation === 'armed' && state.releaseRetain === undefined) state.releaseRetain = state.owner.retain()
    if (activation === 'disarmed') { state.releaseRetain?.(); state.releaseRetain = undefined }
    state.activation = activation
  }
  private phase(goal: GoalSnapshot, allowed: readonly GoalPhase[], phase: GoalPhase): GoalSnapshot {
    if (!allowed.includes(goal.phase)) throw new GoalError(`cannot enter ${phase} from ${goal.phase}`, 'GOAL_INVALID_TRANSITION')
    const { blockedReason: _, ...fields } = goal
    return { ...fields, phase }
  }
  private createdAt(folded: FoldedGoal): number {
    if (folded.createdAt === undefined) throw new Error('native-goal: current Goal lacks durable creation time')
    return folded.createdAt
  }
  private time(folded: FoldedGoal): number {
    if (folded.updatedAt === undefined) throw new Error('native-goal: current Goal lacks durable mutation time')
    return Math.max(Date.now(), folded.updatedAt + 1)
  }
}

/** Native Goal Provider; continuation driving belongs to its separate Consumer. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-goal', targets: ['host'], requires: ['agents', 'activeSessions'], provides: ['goals'],
  resolve(input) {
    const config = resolveNativeGoalConfig(input)
    return (context) => {
      const goals = new NativeGoalRegistry(context.require('agents'), context.require('activeSessions'), config)
      context.provide('goals', goals)
      context.own(() => goals.dispose())
    }
  },
}
