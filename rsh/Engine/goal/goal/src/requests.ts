/** Shared Goal request resolution for native and compatibility Consumers. */
import { GoalError } from './runtime.ts'
import type { CreateGoalRequest, GoalBlockReason, GoalRef, GoalSnapshot } from './types.ts'

/** Validated create input with every deployment default materialized. */
export interface ResolvedCreateGoal {
  readonly expectedRef?: GoalRef | null
  readonly objective: string
  readonly maxGoalRounds: number
}

/**
 * Validate a round cap.
 * @param value - input round count.
 * @returns positive safe integer.
 */
export function resolveMaxGoalRounds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GoalError('maxGoalRounds must be a positive safe integer', 'GOAL_INVALID_MAX_ROUNDS')
  }
  return value
}

/**
 * Normalize an objective.
 * @param value - supplied objective.
 * @returns nonempty trimmed objective.
 */
export function resolveObjective(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GoalError('goal objective must be a non-empty string', 'GOAL_INVALID_OBJECTIVE')
  }
  return value.trim()
}

/**
 * Materialize deployment defaults.
 * @param request - objective, optional round cap and observed creation reference.
 * @param defaultMaxGoalRounds - configured positive round cap.
 * @returns resolved creation fields.
 */
export function resolveCreateGoal(request: CreateGoalRequest, defaultMaxGoalRounds: number): ResolvedCreateGoal {
  return {
    ...request.expectedRef === undefined ? {} : { expectedRef: request.expectedRef === null ? null : { ...request.expectedRef } },
    objective: resolveObjective(request.objective),
    maxGoalRounds: resolveMaxGoalRounds(request.maxGoalRounds ?? defaultMaxGoalRounds),
  }
}

/**
 * Validate a blocker.
 * @param reason - policy-owned blocker.
 * @returns detached normalized explanation.
 */
export function resolveBlockReason(reason: unknown): GoalBlockReason {
  const record = typeof reason === 'object' && reason !== null && !Array.isArray(reason)
    ? reason as Record<string, unknown>
    : undefined
  const code = record?.['code']
  const message = record?.['message']
  if (typeof code !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code)
    || typeof message !== 'string' || message.trim().length === 0) {
    throw new GoalError(
      'goal block reason requires a lower-kebab-case code and a non-empty message',
      'GOAL_INVALID_BLOCK_REASON',
    )
  }
  return { code, message: message.trim() }
}

/** Validate an optional creation observation at the owning mutation admission point.
 * @param expected - detached expected absence or completed Goal revision; omitted preserves existing behavior.
 * @param current - current durable Goal at mutation admission.
 */
export function assertGoalCreationReference(expected: GoalRef | null | undefined, current: GoalSnapshot | undefined): void {
  if (expected === undefined) return
  if (expected === null ? current !== undefined
    : current === undefined || current.id !== expected.id || current.revision !== expected.revision) {
    throw new GoalError('stale Goal revision', 'GOAL_STALE_REVISION')
  }
}
