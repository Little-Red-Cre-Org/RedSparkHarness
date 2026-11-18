/** Short-lived read-handle access to persisted Team member Sessions. */

import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@redspark/rsh-session/native'

/** Read-only stored-Session access shared by the Cordis and Native persistence services. */
export interface PersistedSessionSource {
  /**
   * Open one stored Session without taking write ownership.
   * @param id - stored Session identity.
   * @param access - fixed read access.
   * @param options - optional cancellation for open work.
   * @returns an open read handle.
   */
  open(
    id: SessionId,
    access: 'read',
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    readonly header: SessionHeader
    readonly inheritedEventCount: SessionLogOffset
    read(
      offset?: number,
      length?: number,
      options?: { readonly signal?: AbortSignal },
    ): Promise<{ readonly events: readonly SessionEvent[] }>
    close(): Promise<void>
  }>
}

/** One persisted Session's detached header and complete committed event log. */
export interface PersistedSessionView {
  /** Exact fork-inherited event count paired with `header`. */
  readonly inheritedEventCount: SessionLogOffset
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
}

/**
 * Read one stored session's header and complete event log through a
 * short-lived read handle, closing the handle before returning.
 * @param persistence - the durable session store.
 * @param id - the stored session to read.
 * @param signal - cancellation observed by open and read.
 * @returns the stored header and every committed event.
 */
export async function readPersistedSession(
  persistence: PersistedSessionSource,
  id: SessionId,
  signal: AbortSignal,
): Promise<PersistedSessionView> {
  const handle = await persistence.open(id, 'read', { signal })
  try {
    const { events } = await handle.read(0, undefined, { signal })
    return { header: handle.header, inheritedEventCount: handle.inheritedEventCount, events }
  } finally {
    await handle.close()
  }
}
