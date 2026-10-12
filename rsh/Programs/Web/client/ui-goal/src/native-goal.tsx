/** Cordis-free goal display and durable Session-event projection. */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { IconGoalOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { foldGoal } from '@deepseek-ai/dsh-goal/projection'
import type { GoalSnapshot } from '@deepseek-ai/dsh-goal/types'
import type { ReactElement } from 'react'
import { en, zh } from './client/locales.ts'
import type { GoalKey } from './client/locales.ts'
import css from './client/GoalBar.module.css'

/** Current durable goal fields rendered by the Native bar. */
export interface NativeGoalProjection {
  /** Current durable goal snapshot. */
  readonly goal: GoalSnapshot
  /** Highest admitted goal round in the selected Session. */
  readonly roundsStarted: number
}

/** Fold the selected Session's durable goal records into its current goal.
 * @param events - Session history already held by the Native controller.
 * @returns the current goal and admitted-round count, or `null` after clear or before creation.
 */
export function goalFromSessionEvents(events: readonly SessionEvent[]): NativeGoalProjection | null {
  const folded = foldGoal(events)
  return folded.goal === undefined ? null : { goal: folded.goal, roundsStarted: folded.roundsStarted }
}

const PHASE_LABELS = {
  active: 'phase.active',
  paused: 'phase.paused',
  blocked: 'phase.blocked',
  complete: 'phase.complete',
} as const satisfies Record<GoalSnapshot['phase'], GoalKey>

/** Props-only read-only Goal bar for Native Client consumers.
 * @param props - current goal, admitted-round count, and locale.
 * @returns the goal strip or `null` when the Session has no current goal.
 */
export function NativeGoalBar({ goal, locale }: {
  goal: NativeGoalProjection | null
  locale: 'en' | 'zh'
}): ReactElement | null {
  if (goal === null) return null
  const dictionary = locale === 'zh' ? zh : en
  const { goal: snapshot, roundsStarted } = goal
  const progress = dictionary['rounds.progress']
    .replace('{current}', String(roundsStarted))
    .replace('{max}', String(snapshot.maxGoalRounds))
  return <div className={css.dock} data-goal-bar>
    <div className={css.bar} title={snapshot.phase === 'blocked' ? snapshot.blockedReason?.message : undefined}>
      <span className={css.goalGlyph}><IconGoalOutline16 size={14} /></span>
      <span className={css.label}>{dictionary[PHASE_LABELS[snapshot.phase]]}</span>
      <span className={css.objective}>{snapshot.objective}</span>
      <span className={css.progress}>{progress}</span>
    </div>
  </div>
}
