/** Same-session Goal continuation over the selected Program's retained durable inbox. */
import { z } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner, NativeStepAdmissionHook } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeGoalOperations, GoalView } from '@deepseek-ai/dsh-goal/native'
import type { TurnEndReason } from '@deepseek-ai/dsh-session/native'
import { renderGoalRoundPrompt } from './prompt.ts'
import { GoalError } from '@deepseek-ai/dsh-goal/native'
import type { CreateGoalRequest, GoalRef } from '@deepseek-ai/dsh-goal/types'
import type { NativeGoalContinuationOperations, NativeGoalContinuationSource } from './continuation-types.ts'

export type * from './continuation-types.ts'

const Configuration = z.object({ admissionOrder: z.number().default(700) }).strict()
/** Resolved priority of the Goal pre-step admission fence. */
export type NativeGoalDriverConfig = z.infer<typeof Configuration>
/**
 * Resolve driver configuration.
 * @param input - profile JSON.
 * @returns validated priority.
 */
export function resolveNativeGoalDriverConfig(input: unknown): NativeGoalDriverConfig { return Configuration.parse(input ?? {}) }

interface DriverState {
  readonly owner: NativeActiveSessionOwner
  readonly releases: (() => Promise<void>)[]
  attempt: UserMessage | undefined
  stopping: boolean
}

/** Driver Consumer reserves only durable inputs; the Program keeps its sole execution loop and writer. */
export class NativeGoalRoundDriver implements NativeGoalContinuationOperations {
  private readonly states = new Map<NativeActiveSessionOwner, DriverState>()
  private readonly releases: (() => Promise<void>)[]
  private stopping = false
  private disposal: Promise<void> | undefined

  /**
   * @param goals - selected Goal Definition.
   * @param sessions - exact active-owner routing.
   * @param config - resolved admission priority.
   * @param signal - contribution lifetime cancellation.
   */
  constructor(private readonly goals: NativeGoalOperations, private readonly sessions: NativeActiveSessionOperations,
    private readonly config: NativeGoalDriverConfig, private readonly signal: AbortSignal) {
    this.releases = [sessions.onAttached(async (owner) => {
      const state: DriverState = { owner, releases: [], attempt: undefined, stopping: false }
      this.states.set(owner, state)
      state.releases.push(owner.beforeStep(this.admission(state), this.config.admissionOrder))
      state.releases.push(owner.onIdle(async (reason) => { await this.idle(state, reason) }))
      await Promise.resolve()
    }), sessions.onDetached(async (owner) => {
      const state = this.states.get(owner)
      if (state === undefined) return
      this.states.delete(owner)
      state.stopping = true
      const outcomes = await Promise.allSettled(state.releases.map(async (release) => { await release() }))
      const failures: unknown[] = []
      for (const outcome of outcomes) if (outcome.status === 'rejected') failures.push(outcome.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Goal driver detached hook cleanup failed')
    })]
  }

  /** @inheritdoc */
  create(owner: NativeActiveSessionOwner, request: CreateGoalRequest): Promise<GoalView> {
    this.assertOwner(owner)
    return this.goals.create(owner.agent, request)
  }

  /** @inheritdoc */
  async resume(owner: NativeActiveSessionOwner, ref: GoalRef, additionalRounds: number,
    source: NativeGoalContinuationSource): Promise<GoalView> {
    this.assertOwner(owner)
    let goal = this.goals.get(owner.agent)
    if (goal === undefined || goal.id !== ref.id || goal.revision !== ref.revision) {
      throw new GoalError('Goal revision changed before continuation admission', 'GOAL_STALE_REVISION')
    }
    if (goal.phase === 'complete') return goal
    if (goal.phase === 'paused' && source !== 'human') {
      throw new GoalError('A paused Goal requires an explicit human resume operation', 'GOAL_INVALID_TRANSITION')
    }
    if (goal.roundsStarted >= goal.maxGoalRounds) {
      goal = await this.goals.edit(owner.agent, goal, { maxGoalRounds: goal.roundsStarted + additionalRounds })
      this.assertOwner(owner)
    }
    return this.goals.resume(owner.agent, goal)
  }

  private assertOwner(owner: NativeActiveSessionOwner): void {
    const state = this.states.get(owner)
    this.signal.throwIfAborted()
    if (state === undefined || state.stopping || this.stopping || owner.invocation !== 'root' || !this.available(state)) {
      throw new Error('Goal continuation requires the exact root owner with active driver hooks')
    }
  }

  /**
   * Disarm live Goals and drain both contribution and owner hooks, aggregating cleanup failures after release.
   * @returns memoized contribution release.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.stopping = true
    const states = [...this.states.values()]
    for (const state of states) {
      state.stopping = true
      if (this.available(state)) this.goals.disarm(state.owner.agent)
    }
    return this.disposal = (async () => {
      const contributions = await Promise.allSettled(this.releases.map(async (release) => { await release() }))
      const hooks = await Promise.allSettled(states.flatMap(state => state.releases.map(async (release) => { await release() })))
      this.states.clear()
      const failures: unknown[] = []
      for (const outcome of [...contributions, ...hooks]) if (outcome.status === 'rejected') failures.push(outcome.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Goal driver cleanup failed')
    })()
  }

  private available(state: DriverState): boolean {
    return state.owner.writerAvailable && this.sessions.owner(state.owner.agent, state.owner.session) === state.owner
  }
  private active(state: DriverState): GoalView | undefined {
    if (state.stopping || this.stopping || this.signal.aborted || !this.available(state)) return undefined
    const goal = this.goals.get(state.owner.agent)
    return goal?.phase === 'active' && goal.activation === 'armed' ? goal : undefined
  }
  private matches(state: DriverState, submitted: UserMessage, goal: GoalView | undefined): boolean {
    const source = submitted.source
    return state.attempt?.id === submitted.id && source.kind === 'goal' && goal !== undefined
      && source.goalId === goal.id && source.revision === goal.revision && source.round === goal.roundsStarted + 1
      && source.round <= goal.maxGoalRounds
  }
  private admission(state: DriverState): NativeStepAdmissionHook {
    return async (context, next) => {
      const submitted = context.candidates.filter(message => message.source.kind === 'goal')
      if (submitted.length === 0) return await next()
      const goal = this.active(state)
      const message = submitted[0]
      if (submitted.length !== 1 || message === undefined || !this.matches(state, message, goal)) {
        state.attempt = undefined
        return { kind: 'reject', discard: submitted.map(message => message.id) }
      }
      const decision = await next()
      context.signal.throwIfAborted()
      const latest = this.active(state)
      if (latest === undefined || !this.matches(state, message, latest)) {
        state.attempt = undefined
        return { kind: 'reject', discard: [message.id] }
      }
      if (decision.kind === 'reject' || !decision.messages.some(candidate => candidate.id === message.id)) {
        state.attempt = undefined
        await this.goals.block(state.owner.agent, latest, { code: 'prompt-rejected',
          message: 'Goal round was rejected before entering its step.' })
        return { kind: 'reject', discard: [message.id] }
      }
      context.registerCommitCheck(() => {
        const current = this.active(state)
        if (current !== undefined && this.matches(state, message, current)) return []
        if (state.attempt?.id === message.id) state.attempt = undefined
        return [message.id]
      })
      return decision
    }
  }
  private async idle(state: DriverState, reason: TurnEndReason): Promise<void> {
    const goal = this.active(state)
    if (goal === undefined) return
    state.attempt = undefined
    if (reason.kind === 'aborted' || reason.kind === 'error' || reason.kind === 'interrupted' || reason.kind === 'blocked') {
      if (reason.kind === 'aborted' && reason.reason.kind === 'user') await this.goals.pause(state.owner.agent, goal)
      else this.goals.disarm(state.owner.agent)
      return
    }
    await state.owner.flush()
    const latest = this.active(state)
    if (latest === undefined) return
    if (state.owner.messages('next-turn').length > 0 || state.owner.messages('next-step').length > 0) return
    if (latest.roundsStarted >= latest.maxGoalRounds) {
      await this.goals.block(state.owner.agent, latest, { code: 'round-limit',
        message: `Goal reached its configured limit of ${latest.maxGoalRounds} rounds.` })
      return
    }
    const round = latest.roundsStarted + 1
    const message = createUserMessage({ content: renderGoalRoundPrompt(latest, round),
      source: { kind: 'goal', goalId: latest.id, revision: latest.revision, round } })
    state.attempt = message
    try { await state.owner.enqueue(message, 'next-turn', true, this.signal) } catch (failure: unknown) {
      state.attempt = undefined
      const current = this.active(state)
      if (current?.id === latest.id && current.revision === latest.revision) {
        await this.goals.block(state.owner.agent, current, { code: 'queue-failed',
          message: `Could not queue goal round ${round}: ${failure instanceof Error ? failure.message : String(failure)}` })
      }
      throw failure
    }
  }
}

/** Native Goal driver; it contributes no independent execution authority. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-goal-round-driver', targets: ['host'], requires: ['goals', 'activeSessions'], provides: ['goalContinuation'],
  resolve(input) {
    const config = resolveNativeGoalDriverConfig(input)
    return (context) => {
      const driver = new NativeGoalRoundDriver(context.require('goals'), context.require('activeSessions'), config, context.signal)
      context.own(() => driver.dispose())
      context.provide('goalContinuation', driver)
    }
  },
}
