/** Wire presentation facts shared by the Host producer and browser Consumer. */
import type { NativeWebHumanPrompt, NativeWebHumanId } from './human.ts'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by a queued request and its durable inbox message. */
export type NativeSubmissionRequestId = Branded<'native-submission-request'>

/** Brand one caller-generated submission identity.
 * @param value - stable request identity.
 * @returns the same value branded for Native Session submissions.
 */
export function nativeSubmissionRequestId(value: string): NativeSubmissionRequestId {
  return brandString<NativeSubmissionRequestId>(value)
}

/** One accepted request still waiting in the Host inbox. */
export interface NativePendingSubmission {
  /** Caller-generated identity preserved by the durable user message. */
  readonly requestId: NativeSubmissionRequestId
  /** `queued` waits for a later turn; `steering` enters the next model step. */
  readonly placement: 'queued' | 'steering'
  /** The Host persisted this request in its Agent inbox. */
  readonly status: 'accepted'
}

/** Lifecycle update for an accepted queued or steering request. */
export interface NativeSubmissionUpdate {
  /** Submission lifecycle frame tag. */
  readonly type: 'submission-update'
  /** Stable request identity supplied at admission. */
  readonly requestId: NativeSubmissionRequestId
  /** `rejected` means the Host removed the request before model admission. */
  readonly status: 'accepted' | 'rejected' | 'settled'
}

/** Presentation facts from one exact admitted turn; only events are durable. */
export type NativeSessionFollowFrame =
  | { readonly type: 'baseline'; readonly sessionId: SessionId; readonly fromSeq: number; readonly throughSeq: number }
  | { readonly type: 'event'; readonly event: SessionEvent }
  | { readonly type: 'text-start' }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'human'; readonly prompt: NativeWebHumanPrompt }
  | { readonly type: 'human-removed'; readonly id: NativeWebHumanId }
  | NativeSubmissionUpdate
  | { readonly type: 'title-updated' }
  | { readonly type: 'settled' }
