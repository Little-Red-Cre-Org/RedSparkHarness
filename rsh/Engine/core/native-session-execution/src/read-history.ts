/** Stateless bounded history reads over the selected live owner or persistence Provider. */
import type { SessionId, SessionHeader, SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeActiveSessionOperations } from './active-session.ts'

/** Reader cleanup failure remains distinguishable from an ordinary refused observation. */
export class NativeSessionHistoryCleanupError extends Error {}

/** Selected authorities and explicit admission limits; no Agent activation or alternate writer. */
export interface NativeSessionHistoryReadOptions {
  readonly active: NativeActiveSessionOperations
  readonly persistence: Pick<NativeSessionPersistenceOperations, 'open'>
  readonly maxHistoryEvents: number
  readonly label: string
  /** Record real reader teardown failures with the calling request owner. */
  readonly onCleanupFailure: (failure: NativeSessionHistoryCleanupError) => void
}

/** Read a complete bounded history, rejecting stale live ownership and awaiting reader closure.
 * @param id - exact existing Session identity.
 * @param options - selected authorities, validated bounds and cleanup reporting.
 * @param signal - accepted read cancellation; underlying closure still drains after cancellation.
 * @returns detached header and events; history overflow is refused rather than truncated.
 */
export async function readNativeSessionHistory(id: SessionId, options: NativeSessionHistoryReadOptions,
  signal: AbortSignal): Promise<{
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount: number
}> {
  signal.throwIfAborted()
  const maxEvents = options.maxHistoryEvents + 1
  const checked = (events: readonly SessionEvent[]): void => {
    if (events.length > options.maxHistoryEvents) throw new Error(`${options.label}: history exceeds configured event limit`)
  }
  const live = options.active.owners().find(owner => owner.session.id === id)
  if (live !== undefined) {
    const events = await live.readEvents({ maxEvents, signal })
    signal.throwIfAborted()
    if (options.active.owner(live.agent, live.session) !== live) throw new Error(`${options.label}: Session owner was released`)
    checked(events)
    return { header: live.session.header, events, inheritedEventCount: live.inheritedEventCount }
  }
  const reader = await options.persistence.open(id, 'read', { signal })
  let primary: unknown
  try {
    const history = await reader.read(0, maxEvents, { signal })
    signal.throwIfAborted()
    checked(history.events)
    return { header: reader.header, events: history.events, inheritedEventCount: reader.inheritedEventCount }
  } catch (error: unknown) { primary = error; throw error }
  finally {
    try { await reader.close() } catch (cleanup: unknown) {
      const failure = new NativeSessionHistoryCleanupError(`${options.label}: reader cleanup failed`, {
        cause: primary === undefined ? cleanup : new AggregateError([primary, cleanup], `${options.label}: read and cleanup failed`),
      })
      options.onCleanupFailure(failure)
      throw failure
    }
  }
}
