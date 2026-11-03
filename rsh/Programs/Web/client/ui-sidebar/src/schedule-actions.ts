/**
 * Which schedule controls a card may offer.
 *
 * Pure on purpose: "which buttons exist" is the rule this screen keeps getting
 * wrong, and it is the one thing a test can pin without rendering anything.
 *
 * Three rules, each with a reason:
 *
 * * A plan whose Session is closed is not controllable at all. The Host cannot
 *   resolve an owner for it, so every change would fail at the last moment.
 *   Hiding beats disabling: a greyed button still reads as "this could work
 *   eventually", and it never will while the Session is shut.
 * * A Goal plan may be paused from here but not resumed. Pausing only cancels
 *   the live continuation (`pauseActiveGoal` resolves the run by id), while
 *   resuming requires an explicit direct human turn in that Session — a list
 *   screen is by definition not one.
 * * Delete is always offered when the plan is controllable, whatever its kind
 *   or state, because removing a plan is not a state transition on the Goal.
 */

/** One control a card may render. */
export type ScheduleAction = 'pause' | 'resume' | 'delete'

/** The facts the decision needs, taken from one projected job. */
export interface ScheduleControlFacts {
  /** Whether the owning Session is currently live. */
  readonly controllable: boolean
  /** Producer that owns the plan; absent on durable rows written before it was recorded. */
  readonly kind?: 'goal' | 'scheduled' | undefined
  /** Current admission state. */
  readonly state: 'active' | 'paused' | 'failed'
}

/**
 * The controls to render for one plan, in the order they should appear.
 *
 * @param facts - controllability, producer, and state of one plan.
 * @returns the actions to show; empty when the plan cannot be changed at all.
 */
export function scheduleActions(facts: ScheduleControlFacts): readonly ScheduleAction[] {
  if (!facts.controllable) return []
  // A paused plan offers resume; anything else offers pause. A failed plan is
  // not paused, so it offers pause: stopping further attempts is meaningful and
  // the store treats it the same as any other admission change.
  const toggle: ScheduleAction = facts.state === 'paused' ? 'resume' : 'pause'
  // Resume is the only verb a Goal plan may not take from here; pause and
  // delete are both safe for it.
  if (facts.kind === 'goal' && toggle === 'resume') return ['delete']
  return [toggle, 'delete']
}
