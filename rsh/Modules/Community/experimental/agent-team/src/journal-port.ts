/** Team journal seam over one Lead-owned Session log. */

import type { SessionEventMap, SessionId } from '@redspark/rsh-session/types'
import type { TeamState } from './projection.ts'

/** Mutable Team event types written only through the Lead-owned journal. */
export type TeamMutableEventType =
  | 'team/member'
  | 'team/task'
  | 'team/message/queued'
  | 'team/message/delivered'

/** Root identity a Team journal can project and append through. */
export interface TeamRootRef {
  readonly id: SessionId
}

/** Journal operations the roster, mailbox, and task board consume. */
export interface TeamJournalPort<R extends TeamRootRef = TeamRootRef> {
  /**
   * Read authoritative Team state for one root.
   * @param root - exact root whose durable records select the Team.
   * @returns current projected state.
   */
  state(root: R): TeamState

  /**
   * Serialize one root's asynchronous mutation operation.
   * @param rootId - root Session identity selecting the transaction queue.
   * @param operation - complete read-check-append operation.
   * @returns the operation result.
   */
  transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T>

  /**
   * Append and checkpoint one root-owned Team event before publication.
   * @param root - exact root whose Session owns the event.
   * @param type - Team event discriminant.
   * @param data - payload correlated with the event type.
   */
  appendAndFlush<T extends TeamMutableEventType>(
    root: R,
    type: T,
    data: SessionEventMap[T],
  ): Promise<void>
}
