/** Compatibility projection declarations over pure Goal payload types. */
import type {} from '@redspark/rsh-session-projection/types'
import type { GoalProjection, GoalProjectionState } from './types.ts'

declare module '@redspark/rsh-session-projection/types' {
  interface SessionProjectionStateMap {
    goal: GoalProjectionState
  }
  interface SessionProjectionMap {
    /**
     * The session's current goal and admitted-round count, or
     * `null` before the first create and after a clear tombstone.
     * `goal/change` supplies the whole lifecycle value; matching admitted
     * `user/message` events advance `roundsStarted`.
     */
    goal: GoalProjection | null
  }
}
