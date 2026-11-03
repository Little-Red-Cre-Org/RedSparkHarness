/** Browser-safe schedule rows and change frames shared with the Native Host. */
import type { SessionId } from '@redspark/rsh-session/types'

/** One pending scheduled plan without its prompt or captured execution configuration. */
export interface NativeScheduledJob {
  readonly id: string
  readonly sessionId: SessionId
  readonly title: string
  readonly state: 'active' | 'paused' | 'failed'
  readonly schedule: string
  readonly timeZone: string
  readonly nextRunAt?: number
  readonly lastRunAt?: number
  /**
   * Producer that owns the plan; omitted for durable rows written before the
   * field existed. A `goal` plan can only be resumed inside an explicit human
   * turn, so a list screen must not offer that control for one.
   */
  readonly kind?: 'goal' | 'scheduled' | undefined
  /**
   * Whether this connection can change the plan right now.
   *
   * Changing a plan needs its owning Session to be live: ownership is resolved
   * from the Host's active-owner registry, and a closed Session has no entry.
   * The Host therefore reports controllability rather than letting a caller
   * discover it by failing, so a list can hide a control it cannot honour.
   */
  readonly controllable: boolean
}

/** Full baseline or one committed change to the schedule list. */
export type NativeScheduleFrame =
  | { readonly type: 'baseline'; readonly jobs: readonly NativeScheduledJob[] }
  | { readonly type: 'upsert'; readonly job: NativeScheduledJob }
  | { readonly type: 'remove'; readonly id: string }
