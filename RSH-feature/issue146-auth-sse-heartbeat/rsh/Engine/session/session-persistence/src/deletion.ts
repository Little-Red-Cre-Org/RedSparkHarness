/** Recoverable deletion capability owned by the selected durable storage Provider. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { SessionPersistenceRevision } from './revision.ts'

/** Identity of one retained physical deletion, distinct from its Session identity. */
export type SessionDeletionId = Branded<'SessionDeletionId'>
/** Validate a deletion receipt from wire or disk before resolving storage paths.
 * @param value - untrusted receipt identity.
 * @returns validated opaque identity.
 */
export function SessionDeletionId(value: string): SessionDeletionId {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new TypeError('invalid Session deletion identity')
  return brandString<SessionDeletionId>(value)
}
/** Receipt for a removed Session whose original bytes remain recoverable. */
export interface SessionDeletionReceipt { readonly id: SessionDeletionId; readonly sessionId: SessionId }
/** Explicit capability; absence means this Provider does not support physical recoverable deletion. */
export interface NativeSessionDeletionOperations {
  /** Move an inactive stored Session out of its live namespace without rewriting generations.
   * @param id - exact stored Session identity.
   * @param options - cancellation before namespace-move admission; an accepted move completes
   * without rollback or caller cancellation.
   * @returns retained deletion identity after the namespace move completes.
   */
  delete(id: SessionId, options?: { readonly signal?: AbortSignal
    readonly expectedRevision?: SessionPersistenceRevision }): Promise<SessionDeletionReceipt>
  /** Restore original bytes only when the live identity is still absent.
   * @param id - retained deletion identity.
   * @param options - cancellation before namespace-move admission; an accepted move completes
   * without rollback or caller cancellation.
   * @returns restored Session identity; conflicting live identities reject.
   */
  restore(id: SessionDeletionId, options?: { readonly signal?: AbortSignal; readonly expectedCwd?: string }): Promise<SessionId>
  /** Read the retained immutable header without restoring or migrating a generation.
   * @param id - retained deletion identity.
   * @param options - cancellation during disk validation.
   * @returns validated original header for route admission.
   */
  inspect(id: SessionDeletionId, options?: { readonly signal?: AbortSignal }): Promise<SessionHeader>
  /** Enumerate completed retained deletions without opening or activating a Session.
   * @param options - cancellation during receipt scanning.
   * @returns validated receipts; incomplete preparations are not advertised.
   */
  list(options?: { readonly signal?: AbortSignal }): Promise<readonly SessionDeletionReceipt[]>
}
