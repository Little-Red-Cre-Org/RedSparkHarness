/** Cordis-free exact session reads over the selected Native owners and persistence. */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/native'
import { Session, SessionLogOffset, snapshotSessionEvent } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title/native'
import { readColdSessionLog } from './cold-read.ts'
import { SessionQueryError } from './config.ts'
import { assertSessionHeadersCompatible } from './sources.ts'
import { currentSurfaceEvents } from './tracing.ts'
import type {
  SessionLogSnapshot,
  SessionRecord,
  SessionSurfaceSnapshot,
  SessionTitleObservation,
  SessionTitleObservationResult,
} from './types.ts'
export type { SessionSurfaceSnapshot } from './types.ts'

/** Read-only exact session history selected from Native's active-owner registry and persistence. */
export interface NativeSessionQueryOperations {
  /** List stored sessions and exact active owners, newest first. */
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  /**
   * Read one raw log without acquiring a writer.
   * Cold logs are replay-validated; active history is validated by the resident Session.
   * @param sessionId - the logical session identity.
   * @param signal - optional cancellation for source lookup and history reading.
   * @returns a detached complete raw log from one live-preferred source.
   */
  readSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLogSnapshot>
  /** Read the latest log-backed title from one live-preferred source. */
  readTitleSnapshot(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleObservation>
  /** Read titles in first-occurrence order, isolating per-session failures. */
  readTitleSnapshots(sessionIds: readonly SessionId[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]>
  /** Read a validated current model surface from one live-preferred source. */
  readSurface(sessionId: SessionId, signal?: AbortSignal): Promise<SessionSurfaceSnapshot>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionQuery: NativeSessionQueryOperations }
}

interface LogicalSession {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogSnapshot['inheritedEventCount']
  readonly events: SessionEvent[]
}

/** Native exact reads share legacy query folds without acquiring a writer or registering validation Sessions. */
class NativeSessionQuery implements NativeSessionQueryOperations {
  constructor(
    private readonly active: NativeActiveSessionOperations,
    private readonly persistence: Pick<NativeSessionPersistenceOperations, 'list' | 'open'> | undefined,
  ) {}

  /** @inheritdoc */
  async listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    signal?.throwIfAborted()
    const records = new Map<SessionId, SessionRecord>()
    if (this.persistence !== undefined) {
      try {
        const stored = await this.persistence.list(signal === undefined ? undefined : { signal })
        signal?.throwIfAborted()
        for (const snapshot of stored) {
          records.set(snapshot.header.id, {
            header: structuredClone(snapshot.header),
            live: false,
            persisted: true,
          })
        }
      } catch (error: unknown) {
        if (signal?.aborted === true) signal.throwIfAborted()
        throw mapPersistenceFailure('listing sessions', error)
      }
    }
    for (const owner of this.active.owners()) {
      const persisted = records.get(owner.session.id)
      if (persisted !== undefined) assertSessionHeadersCompatible(owner.session.header, persisted.header)
      records.set(owner.session.id, {
        header: structuredClone(owner.session.header),
        live: true,
        persisted: persisted !== undefined,
      })
    }
    signal?.throwIfAborted()
    return [...records.values()].sort(compareSessions)
  }

  /** @inheritdoc */
  async readSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLogSnapshot> {
    const source = await this.load(sessionId, signal)
    return {
      session: structuredClone(source.header),
      inheritedEventCount: source.inheritedEventCount,
      events: source.events.map(snapshotSessionEvent),
    }
  }

  /** @inheritdoc */
  async readTitleSnapshot(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleObservation> {
    const source = await this.load(sessionId, signal)
    const title = foldSessionTitle(source.events)
    return {
      session: structuredClone(source.header),
      ...title === undefined ? {} : { title },
    }
  }

  /** @inheritdoc */
  async readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<SessionTitleObservationResult[]> {
    const results: SessionTitleObservationResult[] = []
    for (const sessionId of new Set(sessionIds)) {
      try {
        results.push({ sessionId, status: 'fulfilled', value: await this.readTitleSnapshot(sessionId, signal) })
      } catch (reason: unknown) {
        if (signal?.aborted === true) signal.throwIfAborted()
        results.push({ sessionId, status: 'rejected', reason })
      }
    }
    return results
  }

  /** @inheritdoc */
  async readSurface(sessionId: SessionId, signal?: AbortSignal): Promise<SessionSurfaceSnapshot> {
    const source = await this.load(sessionId, signal)
    return {
      session: structuredClone(source.header),
      inheritedEventCount: source.inheritedEventCount,
      capturedThroughSeq: source.events.at(-1)?.seq ?? null,
      events: currentSurfaceEvents(sessionId, source.events),
    }
  }

  private async load(sessionId: SessionId, signal?: AbortSignal): Promise<LogicalSession> {
    signal?.throwIfAborted()
    const live = this.active.owners().find(owner => owner.session.id === sessionId)
    if (live !== undefined) {
      const source = await this.readOwner(live, signal)
      if (source !== undefined) return source
    }
    if (this.persistence === undefined) {
      const attached = this.active.owners().find(owner => owner.session.id === sessionId)
      if (attached !== undefined) {
        const source = await this.readOwner(attached, signal)
        if (source !== undefined) return source
      }
      throw notFound(sessionId)
    }

    let listed: SessionHeader | undefined
    try {
      listed = (await this.persistence.list(signal === undefined ? undefined : { signal }))
        .find(snapshot => snapshot.header.id === sessionId)?.header
    } catch (error: unknown) {
      if (signal?.aborted === true) signal.throwIfAborted()
      throw mapPersistenceFailure(`listing session "${sessionId}"`, error)
    }
    signal?.throwIfAborted()
    if (listed === undefined) {
      const attached = this.active.owners().find(owner => owner.session.id === sessionId)
      if (attached !== undefined) {
        const source = await this.readOwner(attached, signal)
        if (source !== undefined) return source
      }
      throw notFound(sessionId)
    }

    let cold: LogicalSession
    try {
      const loaded = await readColdSessionLog(this.persistence, sessionId, signal)
      validateLog(sessionId, loaded.header, loaded.events, loaded.inheritedEventCount)
      cold = { header: loaded.header, inheritedEventCount: loaded.inheritedEventCount, events: loaded.events }
    } catch (error: unknown) {
      if (signal?.aborted === true) signal.throwIfAborted()
      throw mapSessionReadFailure(sessionId, error)
    }
    signal?.throwIfAborted()

    const attached = this.active.owners().find(owner => owner.session.id === sessionId)
    if (attached !== undefined) {
      const source = await this.readOwner(attached, signal)
      if (source !== undefined) return source
    }
    assertSessionHeadersCompatible(cold.header, listed)
    return cold
  }

  private async readOwner(owner: NativeActiveSessionOwner, signal?: AbortSignal): Promise<LogicalSession | undefined> {
    signal?.throwIfAborted()
    let events: readonly SessionEvent[]
    try {
      events = await owner.readEvents(signal === undefined ? undefined : { signal })
    } catch (error: unknown) {
      if (signal?.aborted === true) signal.throwIfAborted()
      if (!this.isCurrent(owner)) return undefined
      throw mapSessionReadFailure(owner.session.id, error)
    }
    signal?.throwIfAborted()
    if (!this.isCurrent(owner)) return undefined
    return {
      header: structuredClone(owner.session.header),
      inheritedEventCount: SessionLogOffset(owner.inheritedEventCount),
      events: events.map(event => structuredClone(event)),
    }
  }

  private isCurrent(owner: NativeActiveSessionOwner): boolean {
    return this.active.owners().includes(owner)
  }
}

function validateLog(
  sessionId: SessionId,
  header: SessionHeader,
  events: readonly SessionEvent[],
  inheritedEventCount: SessionLogSnapshot['inheritedEventCount'],
): void {
  try {
    Session.fromRestore(sessionId, structuredClone(events), structuredClone(header), inheritedEventCount, 'detached')
  } catch (error: unknown) {
    throw corruptSession(sessionId, error)
  }
}

function compareSessions(a: SessionRecord, b: SessionRecord): number {
  return b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id)
}

function notFound(sessionId: SessionId, cause?: unknown): SessionQueryError {
  return new SessionQueryError(
    `session "${sessionId}" not found`,
    'SESSION_QUERY_SESSION_NOT_FOUND',
    cause === undefined ? undefined : { cause },
  )
}

function mapPersistenceFailure(action: string, error: unknown): SessionQueryError {
  return new SessionQueryError(
    `session persistence failed while ${action}: ${errorMessage(error)}`,
    'SESSION_QUERY_PERSISTENCE_FAILED',
    { cause: error },
  )
}

function mapSessionReadFailure(sessionId: SessionId, error: unknown): SessionQueryError {
  if (error instanceof SessionQueryError) return error
  if (hasErrorName(error, 'SessionPersistenceNotFoundError')) return notFound(sessionId, error)
  if (hasErrorName(error, 'SessionPersistenceCorruptionError')) return corruptSession(sessionId, error)
  return mapPersistenceFailure(`reading session "${sessionId}"`, error)
}

function corruptSession(sessionId: SessionId, error: unknown): SessionQueryError {
  return new SessionQueryError(
    `stored session "${sessionId}" is corrupt: ${errorMessage(error)}`,
    'SESSION_QUERY_CORRUPT_SESSION',
    { cause: error },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hasErrorName(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name
}

/** Stateless Native query Provider over the selected Session authorities. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-query',
  targets: ['host'],
  requires: ['activeSessions'],
  optional: ['sessionPersistence'],
  provides: ['sessionQuery'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('session-query: native configuration must be empty')
    }
    return (context) => {
      context.provide('sessionQuery', new NativeSessionQuery(
        context.require('activeSessions'),
        context.optional('sessionPersistence'),
      ))
    }
  },
}
