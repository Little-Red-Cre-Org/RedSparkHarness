/** Wire presentation facts shared by the Host producer and browser Consumer. */
import type { NativeWebHumanPrompt, NativeWebHumanId } from './human.ts'
import type { SessionEvent, SessionId, SessionSeqCursor } from '@deepseek-ai/dsh-session/types'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by a queued request and its durable inbox message. */
export type NativeSubmissionRequestId = Branded<'native-submission-request'>

/** Process-local receipt for a file stored by the selected Native Program. */
export type NativeSessionFileReceiptId = Branded<'native-session-file-receipt'>

/** Upload acknowledgement; the durable FileBlock is created only when a message consumes the receipt. */
export interface NativeSessionFileReceipt {
  readonly receiptId: NativeSessionFileReceiptId
  readonly name: string
  readonly bytes: number
}

/** Ordered message content accepted by Native Session prompt and inbox operations. */
export type NativeSessionInputPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; readonly data: string; readonly name?: string }
  | { readonly type: 'file'; readonly receiptId: NativeSessionFileReceiptId }

/** Ordered text, encoded images and staged files accepted by queue and steer operations. */
export type NativeSessionSubmissionPart = NativeSessionInputPart

/** Brand one caller-generated submission identity.
 * @param value - stable request identity.
 * @returns the same value branded for Native Session submissions.
 */
export function nativeSubmissionRequestId(value: string): NativeSubmissionRequestId {
  return brandString<NativeSubmissionRequestId>(value)
}

/** One durable acknowledgement returned by queue or steer. */
export interface NativeSubmissionAcknowledgement {
  /** Caller-generated identity preserved by the durable user message. */
  readonly requestId: NativeSubmissionRequestId
  /** `queued` waits for a later turn; `steering` enters the next model step. */
  readonly placement: 'queued' | 'steering'
  /** The Host persisted this request in its Agent inbox. */
  readonly status: 'accepted'
}

/** One accepted request still waiting in the Host inbox. */
export interface NativePendingSubmission extends NativeSubmissionAcknowledgement {
  /** Complete durable user message used by the model when this request is claimed. */
  readonly message: UserMessage
}

/** Durable inbox view from one exact Session event prefix. */
export interface NativeSubmissionsSnapshot {
  /** Highest event sequence in the durable prefix used for this view, or `-1` when empty. */
  readonly throughSeq: SessionSeqCursor
  /** Pending messages in their respective next-turn and next-step order. */
  readonly submissions: readonly NativePendingSubmission[]
}

/** Result of replacing text on one exact pending request. */
export interface NativeSubmissionEditResult {
  /** Identity submitted to the mutation. */
  readonly requestId: NativeSubmissionRequestId
  /** `stale` means the request was already claimed, removed or absent. */
  readonly outcome: 'updated' | 'stale'
}

/** Result of promoting one exact queued request. */
export interface NativeSubmissionPromotionResult {
  /** Identity submitted to the mutation. */
  readonly requestId: NativeSubmissionRequestId
  /** `not-promotable` means the request is already in next-step; `stale` means it is absent. */
  readonly outcome: 'promoted' | 'stale' | 'not-promotable'
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
