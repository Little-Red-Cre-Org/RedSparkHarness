/** Browser-safe background-job rows and change frames shared with the Native Host. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * One background job owned by a Session, projected for browser display.
 *
 * `status` mirrors the Agent-owned registry's lifecycle so the list header can
 * render a running, stopping, or settled job without a second round trip.
 * `detail` is the producer's short human label and carries no captured
 * arguments; the retained output stays behind an explicit read call.
 */
export interface NativeSessionJob {
  readonly id: string
  readonly sessionId: SessionId
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

/**
 * Full baseline, one committed change, or one Session leaving the feed.
 *
 * `baseline` is sent once per stream generation and replaces the whole set.
 * `upsert` and `remove` are deltas; `session-gone` drops every job of a Session
 * that closed while the stream was open.
 */
export type NativeSessionJobsFrame =
  | { readonly type: 'baseline'; readonly jobs: readonly NativeSessionJob[] }
  | { readonly type: 'upsert'; readonly job: NativeSessionJob }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'session-gone'; readonly sessionId: SessionId }
