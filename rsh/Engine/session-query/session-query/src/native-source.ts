/** Native Session authorities adapted to the shared query source ports. */

import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import { SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { Session, SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { readColdSessionLog } from './cold-read.ts'
import type {
  SessionQueryLiveSource,
  SessionQueryPersistenceRecord,
  SessionQueryPersistenceSource,
  SessionQuerySource,
  SessionQuerySourceLog,
} from './source.ts'

/** Native persistence adapter with the point read used by prepared observations. */
export interface NativeSessionQueryPersistenceSource extends SessionQueryPersistenceSource {
  /** Read one stored identity without listing unrelated sessions. */
  stat(sessionId: SessionId, signal?: AbortSignal): Promise<SessionQueryPersistenceRecord | undefined>
}

/** Native source whose persistence adapter supports exact point observations. */
export interface NativeSessionQuerySource extends SessionQuerySource {
  persistenceBinding(): {
    readonly identity: object
    readonly store?: NativeSessionQueryPersistenceSource
  }
  /** Capture exact Native owners, including their resident Session instance. */
  liveOwners(): readonly NativeSessionQueryLiveSource[]
}

/** Native live-source view retaining the owner's exact Session object for projection cells. */
export interface NativeSessionQueryLiveSource extends SessionQueryLiveSource {
  /** Exact resident Session owned by this incarnation. */
  readonly session: Session
}

/**
 * Adapt the Program's selected active owners and persistence Provider once for
 * exact reads and SQLite reconciliation; each owner read retains its captured prefix.
 * @param active - exact Program-owned active Session registry.
 * @param persistence - optional selected durable Session authority.
 * @returns one source with stable persistence and per-incarnation owner identities.
 */
export function createNativeSessionQuerySource(
  active: NativeActiveSessionOperations,
  persistence?: NativeSessionPersistenceOperations,
): NativeSessionQuerySource {
  const binding = persistence === undefined
    ? { identity: {} }
    : { identity: {}, store: nativePersistenceSource(persistence) }
  return {
    persistenceBinding: () => binding,
    liveOwners: () => active.owners().map(nativeLiveOwner),
  }
}

function nativePersistenceSource(
  persistence: NativeSessionPersistenceOperations,
): NativeSessionQueryPersistenceSource {
  return {
    async stat(sessionId, signal): Promise<SessionQueryPersistenceRecord | undefined> {
      const stored = await persistence.stat(sessionId, signal === undefined ? undefined : { signal })
      return stored === undefined ? undefined : { header: stored.header, revision: stored.revision }
    },
    async list(signal): Promise<readonly SessionQueryPersistenceRecord[]> {
      return (await persistence.list(signal === undefined ? undefined : { signal }))
        .map(({ header, revision }) => ({ header, revision }))
    },
    async read(sessionId, signal): Promise<SessionQuerySourceLog> {
      const loaded = await readColdSessionLog(persistence, sessionId, signal)
      return {
        header: loaded.header,
        inheritedEventCount: loaded.inheritedEventCount,
        events: loaded.events,
      }
    },
  }
}

function nativeLiveOwner(owner: NativeActiveSessionOwner): NativeSessionQueryLiveSource {
  const capturedEventCount = SessionLogOffset(owner.session.seq)
  return {
    sessionId: owner.session.id,
    ownerToken: owner,
    session: owner.session,
    header: structuredClone(owner.session.header),
    inheritedEventCount: SessionLogOffset(owner.inheritedEventCount),
    capturedEventCount,
    readEvents(maxEvents, signal) {
      if (maxEvents > capturedEventCount) throw new RangeError('session-query: live read exceeds its captured event cut')
      return owner.readEvents(signal === undefined ? { maxEvents } : { maxEvents, signal })
    },
  }
}
