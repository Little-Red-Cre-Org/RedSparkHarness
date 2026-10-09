/** Native exact-cut observations over the selected active and durable authorities. */

import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import {
  Session,
  SessionLogOffset,
  snapshotSessionEvent,
} from '@deepseek-ai/dsh-session/native'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset as SessionLogOffsetValue,
} from '@deepseek-ai/dsh-session/native'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeSessionProjectionCacheOperations } from '@deepseek-ai/dsh-session-projection-cache/native'
import type {
  NativeProjectionObservation,
  NativeSessionProjectionOperations,
  ProjectionCheckpoint,
  ProjectionSnapshot,
} from '@deepseek-ai/dsh-session-projection/native'
import { SessionQueryError } from './config.ts'
import type { NativeSessionQueryLiveSource, NativeSessionQuerySource } from './native-source.ts'
import { assertSessionHeadersCompatible } from './sources.ts'
import type { SessionObservation, SessionObservationOptions, SessionRecord } from './types.ts'

interface PreparedObservation {
  readonly binding: object
  readonly revision: SessionPersistenceRevision
  readonly session: Session
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffsetValue
  readonly events: readonly SessionEvent[]
  leases: number
}

/**
 * Capture live prefixes or stable cold revisions and retain cold preparations
 * while callers hold observation leases.
 */
export class NativeSessionObservationReader {
  private readonly cache = new Map<SessionId, PreparedObservation>()
  private readonly pending = new Set<Promise<void>>()
  private readonly controller = new AbortController()
  private closing = false
  private closeResult: Promise<void> | undefined

  /**
   * @param source - current Native owner and persistence bindings.
   * @param projections - shared state-fold registry for client projections.
   * @param checkpointCache - optional durable rows used only as fold shortcuts.
   * @param capacity - maximum unpinned prepared revisions retained for reuse.
   */
  constructor(
    private readonly source: NativeSessionQuerySource,
    private readonly projections: NativeSessionProjectionOperations | undefined,
    private readonly checkpointCache: NativeSessionProjectionCacheOperations | undefined,
    private readonly capacity: number,
  ) {}

  /**
   * Capture one live-preferred immutable observation lease.
   * @param sessionId - logical Session identity.
   * @param options - projection selection and caller cancellation.
   * @returns a caller-owned observation lease.
   */
  read(sessionId: SessionId, options: SessionObservationOptions = {}): Promise<SessionObservation> {
    const captured = {
      projectionMode: options.projectionMode ?? 'all',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }
    return this.own(() => this.readOwned(sessionId, captured))
  }

  /**
   * List durable records over one stable binding and merge the current owners.
   * @param signal - optional cancellation for persistence listing.
   * @returns live-preferred records in deterministic order.
   */
  list(signal?: AbortSignal): Promise<SessionRecord[]> {
    return this.own(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        this.assertAvailable(signal)
        const binding = this.source.persistenceBinding()
        const records = new Map<SessionId, SessionRecord>()
        if (binding.store !== undefined) {
          try {
            const persisted = await binding.store.list(this.operationSignal(signal))
            for (const record of persisted) {
              records.set(record.header.id, {
                header: structuredClone(record.header),
                live: false,
                persisted: true,
              })
            }
          } catch (error: unknown) {
            this.assertAvailable(signal)
            throw persistenceFailure('listing sessions', error)
          }
          this.assertAvailable(signal)
          if (this.source.persistenceBinding().identity !== binding.identity) continue
        }
        for (const owner of this.source.liveOwners()) {
          const persisted = records.get(owner.sessionId)
          if (persisted !== undefined) assertSessionHeadersCompatible(owner.header, persisted.header)
          records.set(owner.sessionId, {
            header: structuredClone(owner.header),
            live: true,
            persisted: persisted !== undefined,
          })
        }
        return [...records.values()].sort((a, b) => b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id))
      }
      throw sourceChanged()
    })
  }

  /** Close admission, join every started source operation, and release unpinned preparations. */
  close(): Promise<void> {
    if (this.closeResult !== undefined) return this.closeResult
    this.closing = true
    this.controller.abort()
    this.closeResult = Promise.all([...this.pending]).then(() => { this.cache.clear() })
    return this.closeResult
  }

  private own<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(providerClosed())
    const task = operation()
    const settled = task.then(() => undefined, () => undefined)
    this.pending.add(settled)
    void settled.then(() => this.pending.delete(settled))
    return task
  }

  private async readOwned(sessionId: SessionId, options: SessionObservationOptions): Promise<SessionObservation> {
    const { signal, projectionMode = 'all' } = options
    for (let attempt = 0; attempt < 2; attempt++) {
      this.assertAvailable(signal)
      const owner = this.owner(sessionId)
      if (owner !== undefined) {
        const live = await this.readLive(owner, projectionMode, signal)
        if (live !== undefined) return live
        continue
      }

      const binding = this.source.persistenceBinding()
      const store = binding.store
      if (store === undefined) throw notFound(sessionId)
      const record = await this.stat(store, sessionId, signal)
      if (this.source.persistenceBinding().identity !== binding.identity) continue
      const attachedAfterStat = this.owner(sessionId)
      if (attachedAfterStat !== undefined) {
        const live = await this.readLive(attachedAfterStat, projectionMode, signal)
        if (live !== undefined) return live
        continue
      }
      if (record === undefined) throw notFound(sessionId)

      let prepared = this.cached(binding.identity, sessionId, record.revision)
      if (prepared === undefined) {
        const loaded = await this.readCold(store, sessionId, signal)
        if (this.source.persistenceBinding().identity !== binding.identity) continue
        const afterRead = await this.stat(store, sessionId, signal)
        if (this.source.persistenceBinding().identity !== binding.identity) continue
        const attachedAfterRead = this.owner(sessionId)
        if (attachedAfterRead !== undefined) {
          const live = await this.readLive(attachedAfterRead, projectionMode, signal)
          if (live !== undefined) return live
          continue
        }
        if (afterRead === undefined || afterRead.revision !== record.revision) continue
        assertHeaderMatches(record.header, loaded.header)
        assertHeaderMatches(record.header, afterRead.header)
        prepared = this.prepare(binding.identity, record.revision, loaded.header, loaded.inheritedEventCount, loaded.events)
        this.cache.set(sessionId, prepared)
        this.evict(prepared)
      }
      const projection = this.project(undefined, prepared.header, prepared.inheritedEventCount, prepared.events, projectionMode)
      return this.lease(prepared, projection, record.revision)
    }
    throw sourceChanged()
  }

  private async readLive(
    owner: NativeSessionQueryLiveSource,
    projectionMode: NonNullable<SessionObservationOptions['projectionMode']>,
    signal: AbortSignal | undefined,
  ): Promise<SessionObservation | undefined> {
    this.assertAvailable(signal)
    let events: readonly SessionEvent[]
    try {
      events = await owner.readEvents(owner.capturedEventCount, this.operationSignal(signal))
    } catch (error: unknown) {
      this.assertAvailable(signal)
      if (this.owner(owner.sessionId)?.ownerToken !== owner.ownerToken) return undefined
      throw sourceReadFailure(owner.sessionId, error)
    }
    this.assertAvailable(signal)
    if (this.owner(owner.sessionId)?.ownerToken !== owner.ownerToken) return undefined
    const detached = freezeEvents(events)
    const projection = this.project(owner.session, owner.header, owner.inheritedEventCount, detached, projectionMode)
    return this.liveLease(owner.header, owner.inheritedEventCount, detached, projection)
  }

  private async stat(
    store: NonNullable<ReturnType<NativeSessionQuerySource['persistenceBinding']>['store']>,
    sessionId: SessionId,
    signal: AbortSignal | undefined,
  ) {
    try {
      const record = await store.stat(sessionId, this.operationSignal(signal))
      this.assertAvailable(signal)
      return record
    } catch (error: unknown) {
      this.assertAvailable(signal)
      throw sourceReadFailure(sessionId, error)
    }
  }

  private async readCold(
    store: NonNullable<ReturnType<NativeSessionQuerySource['persistenceBinding']>['store']>,
    sessionId: SessionId,
    signal: AbortSignal | undefined,
  ) {
    try {
      const loaded = await store.read(sessionId, this.operationSignal(signal))
      this.assertAvailable(signal)
      return loaded
    } catch (error: unknown) {
      this.assertAvailable(signal)
      throw sourceReadFailure(sessionId, error)
    }
  }

  private prepare(
    binding: object,
    revision: SessionPersistenceRevision,
    header: SessionHeader,
    inheritedEventCount: SessionLogOffsetValue,
    sourceEvents: readonly SessionEvent[],
  ): PreparedObservation {
    const events = freezeEvents(sourceEvents)
    let session: Session
    try {
      session = Session.fromRestore(
        header.id,
        events,
        deepFreeze(structuredClone(header)),
        SessionLogOffset(inheritedEventCount),
        'detached',
      )
    } catch (error: unknown) {
      throw corruptSession(header.id, error)
    }
    return {
      binding,
      revision,
      session,
      header: session.header,
      inheritedEventCount: session.inheritedEventCount,
      events,
      leases: 0,
    }
  }

  private project(
    session: Session | undefined,
    header: SessionHeader,
    inheritedEventCount: SessionLogOffsetValue,
    events: readonly SessionEvent[],
    mode: NonNullable<SessionObservationOptions['projectionMode']>,
  ): ProjectionSnapshot | undefined {
    if (mode === 'none' || this.projections === undefined) return undefined
    let checkpoint: ProjectionCheckpoint = {}
    try {
      checkpoint = this.checkpointCache?.cachedCheckpoint(header, inheritedEventCount) ?? {}
    } catch {
      // A projection checkpoint is derived data; the event log remains authoritative.
    }
    const input = {
      header,
      inheritedEventCount,
      checkpoint,
      events,
      baseSeq: SessionLogOffset(0),
    }
    const observed: NativeProjectionObservation = session === undefined
      ? this.projections.observe(input)
      : this.projections.observe({ ...input, session })
    return deepFreeze(structuredClone({ asOfSeq: observed.asOfSeq, values: observed.values }))
  }

  private cached(binding: object, sessionId: SessionId, revision: SessionPersistenceRevision): PreparedObservation | undefined {
    const entry = this.cache.get(sessionId)
    if (entry === undefined || entry.binding !== binding || entry.revision !== revision) return undefined
    this.cache.delete(sessionId)
    this.cache.set(sessionId, entry)
    return entry
  }

  private lease(
    entry: PreparedObservation,
    projections: ProjectionSnapshot | undefined,
    revision: SessionPersistenceRevision,
  ): SessionObservation {
    entry.leases += 1
    const lease = (): SessionObservation => this.makeLease(
      entry.header,
      entry.inheritedEventCount,
      entry.events,
      'prepared',
      projections,
      revision,
      () => {
        entry.leases -= 1
        this.evict()
      },
      () => {
        entry.leases += 1
        return lease()
      },
    )
    return lease()
  }

  private liveLease(
    header: SessionHeader,
    inheritedEventCount: SessionLogOffsetValue,
    events: readonly SessionEvent[],
    projections: ProjectionSnapshot | undefined,
  ): SessionObservation {
    return this.makeLease(header, inheritedEventCount, events, 'live', projections, undefined, () => {}, () =>
      this.liveLease(header, inheritedEventCount, events, projections))
  }

  private makeLease(
    header: SessionHeader,
    inheritedEventCount: SessionLogOffsetValue,
    events: readonly SessionEvent[],
    source: SessionObservation['source'],
    projections: ProjectionSnapshot | undefined,
    revision: SessionPersistenceRevision | undefined,
    release: () => void,
    retain: () => SessionObservation,
  ): SessionObservation {
    let disposed = false
    return {
      source,
      header: deepFreeze(structuredClone(header)),
      inheritedEventCount,
      events,
      cursor: events.at(-1)?.seq ?? -1,
      ...revision === undefined ? {} : { revision },
      ...projections === undefined ? {} : { projections },
      retain: () => {
        if (disposed) throw new Error(`session observation "${header.id}" is disposed`)
        return retain()
      },
      [Symbol.dispose]: () => {
        if (disposed) return
        disposed = true
        release()
      },
    }
  }

  private owner(sessionId: SessionId): NativeSessionQueryLiveSource | undefined {
    return this.source.liveOwners().find(owner => owner.sessionId === sessionId)
  }

  private operationSignal(signal: AbortSignal | undefined): AbortSignal {
    return signal === undefined ? this.controller.signal : AbortSignal.any([signal, this.controller.signal])
  }

  private assertAvailable(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) throw signal.reason
    if (this.closing) throw providerClosed()
  }

  private evict(keep?: PreparedObservation): void {
    if (this.cache.size <= this.capacity) return
    for (const [id, candidate] of this.cache) {
      if (candidate === keep || candidate.leases > 0) continue
      this.cache.delete(id)
      if (this.cache.size <= this.capacity) return
    }
  }
}

function freezeEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
  return Object.freeze(events.map(snapshotSessionEvent))
}

function assertHeaderMatches(expected: SessionHeader, actual: SessionHeader): void {
  if (expected.id !== actual.id || expected.createdAt !== actual.createdAt
    || expected.cwd !== actual.cwd || expected.isSeeded !== actual.isSeeded
    || expected.parentSession !== actual.parentSession || expected.delegationDepth !== actual.delegationDepth) {
    throw new SessionQueryError(`session "${expected.id}" changed identity during observation`, 'SESSION_QUERY_SOURCE_CONFLICT')
  }
}

function sourceChanged(): SessionQueryError {
  return new SessionQueryError('session source changed repeatedly during observation', 'SESSION_QUERY_SOURCE_CONFLICT')
}

function providerClosed(): SessionQueryError {
  return new SessionQueryError('session-query provider is closed', 'SESSION_QUERY_PROVIDER_CLOSED')
}

function notFound(sessionId: SessionId, cause?: unknown): SessionQueryError {
  return new SessionQueryError(
    `session "${sessionId}" not found`,
    'SESSION_QUERY_SESSION_NOT_FOUND',
    cause === undefined ? undefined : { cause },
  )
}

function persistenceFailure(action: string, error: unknown): SessionQueryError {
  return new SessionQueryError(`session persistence failed while ${action}: ${errorMessage(error)}`, 'SESSION_QUERY_PERSISTENCE_FAILED', { cause: error })
}

function sourceReadFailure(sessionId: SessionId, error: unknown): SessionQueryError {
  if (error instanceof SessionQueryError) return error
  if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError') return notFound(sessionId, error)
  if (error instanceof Error && error.name === 'SessionPersistenceCorruptionError') return corruptSession(sessionId, error)
  return persistenceFailure(`reading session "${sessionId}"`, error)
}

function corruptSession(sessionId: SessionId, error: unknown): SessionQueryError {
  return new SessionQueryError(`stored session "${sessionId}" is corrupt: ${errorMessage(error)}`, 'SESSION_QUERY_CORRUPT_SESSION', { cause: error })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
