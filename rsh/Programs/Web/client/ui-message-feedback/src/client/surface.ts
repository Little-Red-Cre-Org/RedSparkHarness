/**
 * One Session's feedback surface: the message-feedback object layer and the
 * dialog controller, plus the routing between them. A message target puts a
 * selected judgment through the message controller; the Session target records
 * through the Session-feedback call of the same transport.
 *
 * The surface holds no framework reference: it is built from a
 * {@link FeedbackSurfaceTransport}, which the browser build binds to
 * `ctx.remote.messageFeedback` / `ctx.remote.sessionFeedback` and the Native
 * build binds to `clientNativeSession`. One object layer therefore serves both
 * clients with the same compare-and-set semantics.
 * @module @redspark/rsh-client-ui-message-feedback/client/surface
 */

import type { SessionId } from '@redspark/rsh-session/types'
import type { FeedbackRecord, SessionFeedbackRecordRequest, SessionFeedbackRecordResult } from '@redspark/rsh-command-feedback/types'
import {
  MessageFeedbackController, describe,
  type MessageFeedbackActionFailure,
  type MessageFeedbackCarried,
  type MessageFeedbackTransport,
} from './controller.ts'
import { FeedbackDialogController } from './dialog.ts'

/** The Session-level remark call, in the same two-level carrier shape. */
export interface SessionFeedbackCall {
  (request: SessionFeedbackRecordRequest): Promise<MessageFeedbackCarried<SessionFeedbackRecordResult>>
}

/** Everything one Session's feedback surface needs from its Host connection. */
export interface FeedbackSurfaceTransport extends MessageFeedbackTransport {
  /** Record one Session-level remark (the `/feedback <text>` path). */
  recordSession: SessionFeedbackCall
}

/** The per-session pair behind every entry of one Session. */
export class FeedbackSurface {
  /** The Session's message-feedback object layer, shared by every message control. */
  readonly feedback: MessageFeedbackController
  /** The Session's dialog and toast state, shared by the overlay entry and the message controls. */
  readonly dialog: FeedbackDialogController

  /**
   * @param transport - the Host feedback calls bound to one connection.
   * @param sessionId - Session owning the transcript and the remark.
   */
  constructor(private readonly transport: FeedbackSurfaceTransport, private readonly sessionId: SessionId) {
    this.feedback = new MessageFeedbackController(transport, sessionId)
    this.dialog = new FeedbackDialogController((target, entry) => target.kind === 'message'
      ? this.feedback.rate(target.messageId, target.rating, entry)
      : this.recordSession(entry))
  }

  /** Record one Session-level remark through the transport's Session-feedback call. */
  private async recordSession(entry: FeedbackRecord): Promise<MessageFeedbackActionFailure | { ok: true }> {
    const carried = await this.transport.recordSession({ sessionId: this.sessionId, ...entry })
    if (!carried.ok) return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
    if (carried.value.ok) return { ok: true }
    return { ok: false, error: { code: carried.value.error.code, message: describe(carried.value.error.code) } }
  }

  /** Drop both controllers when the owning fiber unloads. */
  dispose(): void {
    this.feedback.dispose()
    this.dialog.dispose()
  }
}
