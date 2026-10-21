/** Backend-neutral source ports consumed by the shared session-query index. */

import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence/native'

/** One detached complete log returned from the selected source. */
export interface SessionQuerySourceLog {
  /** Header selected with these events. */
  readonly header: SessionHeader
  /** Exact number of fork-inherited events. */
  readonly inheritedEventCount: SessionLogOffset
  /** Contiguous raw events after any in-memory cold-tail repair. */
  readonly events: readonly SessionEvent[]
}

/** One durable session identity and its revision at a corpus listing cut. */
export interface SessionQueryPersistenceRecord {
  /** Stored header from this listing. */
  readonly header: SessionHeader
  /** Opaque durable revision used to reuse an unchanged indexed log. */
  readonly revision: SessionPersistenceRevision
}

/** Read-only durable source used by the shared SQLite observation algorithm. */
export interface SessionQueryPersistenceSource {
  /**
   * Observe one durable identity and revision without reading its event log.
   * @param sessionId - stored session to observe.
   * @param signal - cancellation for the metadata read.
   * @returns the identity and comparable revision, or undefined when absent.
   */
  stat?(sessionId: SessionId, signal?: AbortSignal): Promise<SessionQueryPersistenceRecord | undefined>
  /**
   * List exact stored identities and revisions.
   * @param signal - cancellation for the listing.
   * @returns after the listing has fully settled, including cancellation.
   */
  list(signal?: AbortSignal): Promise<readonly SessionQueryPersistenceRecord[]>
  /**
   * Read and repair one cold log without taking write ownership.
   * @param sessionId - stored session to read.
   * @param signal - cancellation for opening, reading, and closing its handle.
   * @returns after open, read, and close have all settled; recovery closers are in-memory only.
   */
  read(sessionId: SessionId, signal?: AbortSignal): Promise<SessionQuerySourceLog>
}

/** One exact active Session owner captured from its selected Program registry. */
export interface SessionQueryLiveSource {
  /** Logical Session identity. */
  readonly sessionId: SessionId
  /** Stable identity of this owner incarnation, used to detect replacement. */
  readonly ownerToken: object
  /** Immutable header captured with this owner. */
  readonly header: SessionHeader
  /** Exact fork-inherited prefix length. */
  readonly inheritedEventCount: SessionLogOffset
  /** Event count captured with this owner before any asynchronous read begins. */
  readonly capturedEventCount: SessionLogOffset
  /**
   * Read the captured validated prefix without acquiring a writer.
   * @param maxEvents - captured event count; appended events beyond this cut are excluded.
   * @param signal - cancellation for this prefix read.
   * @returns events below `maxEvents`, after all underlying work has settled.
   */
  readEvents(maxEvents: SessionLogOffset, signal?: AbortSignal): Promise<readonly SessionEvent[]>
}

/** Current durable binding and live owners selected by one Program. */
export interface SessionQuerySource {
  /**
   * Return the current persistence binding. Identity stays stable for one
   * installation and changes on removal or reinstall, even for the same store.
   */
  persistenceBinding(): {
    readonly identity: object
    readonly store?: SessionQueryPersistenceSource
  }
  /** Capture current exact owners before any await; ownerToken is stable only for that incarnation. */
  liveOwners(): readonly SessionQueryLiveSource[]
}
