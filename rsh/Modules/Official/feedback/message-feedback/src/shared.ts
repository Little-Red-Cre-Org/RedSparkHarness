/** Cordis-free validation and projections shared by both Session feedback Providers. */
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { FEEDBACK_CATEGORIES } from '@deepseek-ai/dsh-command-feedback/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  MessageFeedbackFailure, MessageFeedbackItem, MessageFeedbackNoteBlank,
  MessageFeedbackNoteTooLarge, MessageFeedbackRejected, MessageFeedbackSuccess,
  MessageFeedbackVersion, MessageFeedbackVersionConflict,
} from './types.ts'

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Validate one stored feedback item before exposing it. */
export const itemSchema = z.object({
  messageId: z.string().min(1), rating: z.enum(['positive', 'negative']),
  note: z.string().refine(note => note.trim().length > 0).optional(),
  category: z.enum(FEEDBACK_CATEGORIES).optional(), version: z.uuid(),
  createdAt: timestamp, updatedAt: timestamp,
}).refine(item => item.updatedAt >= item.createdAt)
/** Validate a stored put event before applying its current value. */
export const putSchema = z.object({ sessionId: z.string().min(1), item: itemSchema })
/** Validate a stored delete event before removing its current value. */
export const deleteSchema = z.object({ sessionId: z.string().min(1), messageId: z.string().min(1) })

/** Persisted message-feedback events with their Session envelopes. */
export type FeedbackEvent = SessionEvent<'feedback/message-put' | 'feedback/message-delete'>
/** Message-feedback payload accepted by a Session writer. */
export type Mutation = Pick<SessionEvent<'feedback/message-put'>, 'type' | 'data'>
  | Pick<SessionEvent<'feedback/message-delete'>, 'type' | 'data'>
/**
 * Append an optional mutation; omission leaves the Session unchanged.
 * @param event - mutation to append, or no mutation.
 * @returns completion after the selected writer accepts the operation.
 */
export type Append = (event?: Mutation) => Promise<void>
/** Rejection when the requested Session cannot be opened. */
export type MissingSession = MessageFeedbackRejected<Extract<MessageFeedbackFailure, { code: 'session-not-found' }>>
/** Validated optional note or its stable validation failure. */
export type ResolvedNote = MessageFeedbackSuccess<string | undefined>
  | MessageFeedbackRejected<MessageFeedbackNoteBlank | MessageFeedbackNoteTooLarge>

/**
 * Detach a feedback item from the log for its caller.
 * @param item - current stored item.
 * @returns a frozen copy.
 */
export function snapshotItem(item: MessageFeedbackItem): MessageFeedbackItem {
  return Object.freeze({ ...item })
}

/**
 * Wrap an accepted operation value.
 * @param value - successful operation result.
 * @returns an immutable result envelope.
 */
export function success<T>(value: T): MessageFeedbackSuccess<T> {
  return Object.freeze({ ok: true, value })
}

/**
 * Wrap a stable business failure.
 * @param error - operation rejection.
 * @returns an immutable rejection.
 */
export function rejected<E extends MessageFeedbackFailure>(error: E): MessageFeedbackRejected<E> {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/**
 * Validate persisted payloads and derive current Session-owned feedback.
 * @param sessionId - Session whose feedback is requested.
 * @param events - canonical Session events in append order.
 * @returns current Session-owned items.
 */
export function currentItems(sessionId: SessionId, events: readonly SessionEvent[]): MessageFeedbackItem[] {
  const items = new Map<MessageFeedbackItem['messageId'], MessageFeedbackItem>()
  for (const event of events) {
    switch (event.type) {
      case 'feedback/message-put':
        putSchema.parse(event.data)
        if (event.data.sessionId === sessionId) items.set(event.data.item.messageId, event.data.item)
        break
      case 'feedback/message-delete':
        deleteSchema.parse(event.data)
        if (event.data.sessionId === sessionId) items.delete(event.data.messageId)
        break
      default:
        break
    }
  }
  return [...items.values()]
}

/**
 * Validate optional note text without changing its contents.
 * @param note - submitted note.
 * @param maxNoteBytes - configured UTF-8 limit.
 * @returns validated optional note or a business failure.
 */
export function resolveNote(note: string | undefined, maxNoteBytes: number): ResolvedNote {
  if (note === undefined) return success(undefined)
  if (note.trim().length === 0) return rejected({ code: 'note-blank' })
  const actualBytes = Buffer.byteLength(note, 'utf8')
  return actualBytes > maxNoteBytes
    ? rejected({ code: 'note-too-large', maxBytes: maxNoteBytes, actualBytes })
    : success(note)
}

/**
 * Report a version conflict without exposing the stored item.
 * @param current - authoritative item at the observed version.
 * @returns a detached conflict value.
 */
export function versionConflict(current: MessageFeedbackItem | null): MessageFeedbackVersionConflict {
  return { code: 'version-conflict', current: current === null ? null : snapshotItem(current) }
}

export type { MessageFeedbackVersion }
