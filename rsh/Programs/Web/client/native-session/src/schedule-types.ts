/** Browser-safe schedule rows and change frames shared with the Native Host. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
}

/** Full baseline or one committed change to the schedule list. */
export type NativeScheduleFrame =
  | { readonly type: 'baseline'; readonly jobs: readonly NativeScheduledJob[] }
  | { readonly type: 'upsert'; readonly job: NativeScheduledJob }
  | { readonly type: 'remove'; readonly id: string }
