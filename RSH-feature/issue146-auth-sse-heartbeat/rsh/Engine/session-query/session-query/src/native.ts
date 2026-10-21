/** Cordis-free exact session reads over the selected Native authorities. */

import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { SessionSeq, snapshotSessionEvent } from '@deepseek-ai/dsh-session/native'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionProjectionCacheOperations } from '@deepseek-ai/dsh-session-projection-cache/native'
import type { NativeSessionProjectionOperations } from '@deepseek-ai/dsh-session-projection/native'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-native-agent/turn-boundary'
import { foldSessionTitle, type SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title/native'
import { SessionQueryError, type Config, SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY, SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE, SESSION_QUERY_READ_WINDOW_MAX } from './config.ts'
import type { SessionQueryOperations } from './definition.ts'
import { buildSessionEventSearchDocuments } from './documents.ts'
import { filterSessionEventDocuments, filterSessionResults, materializeSessionEventResultFilters, materializeSessionResultFilters } from './filters.ts'
import { NativeSessionObservationReader } from './native-observation.ts'
import { createNativeSessionQuerySource, type NativeSessionQuerySource } from './native-source.ts'
import { currentSurfaceEvents, eventRecords, traceEvent, traceSession } from './tracing.ts'
import type {
  SessionEventReadRequest,
  SessionEventRecord,
  SessionEventResultFilter,
  SessionEventSearchDocument,
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionEventTraceObservation,
  SessionEventTraceRequest,
  SessionEventWindow,
  SessionLineageTrace,
  SessionLogSnapshot,
  SessionObservation,
  SessionObservationOptions,
  SessionRecord,
  SessionResultFilter,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
  SessionSurfaceSnapshot,
  SessionTitleObservation,
  SessionTitleObservationResult,
} from './types.ts'

export type * from './types.ts'
export type { SessionQueryOperations } from './definition.ts'
/** Compatibility name for Native consumers of the shared service Definition. */
export type NativeSessionQueryOperations = SessionQueryOperations
export type { Config, SessionQueryErrorCode } from './config.ts'
export { SessionQueryError } from './config.ts'
export {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  SESSION_QUERY_READ_WINDOW_MAX,
} from './config.ts'
export { SessionSearchCursor } from './cursor.ts'
export { buildSessionEventSearchDocuments } from './documents.ts'
export { extractSessionEventText } from './extraction.ts'
export { materializeSessionEventResultFilters, materializeSessionResultFilters } from './filters.ts'
export { assertSessionHeadersCompatible } from './sources.ts'
export { eventRecords, traceEvent, traceSession } from './tracing.ts'
export { createNativeSessionQuerySource } from './native-source.ts'
export type { NativeSessionQuerySource, NativeSessionQueryLiveSource, NativeSessionQueryPersistenceSource } from './native-source.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionQuery: SessionQueryOperations }
}

/** Full-text operations supplied by one selected Native query backend. */
export interface NativeSessionQuerySearchOperations {
  /** Search across the observed session corpus. */
  searchSessions(request: SessionSearchRequest, signal?: AbortSignal): Promise<SessionSearchPage<SessionSearchHit>>
  /** Search events within one observed session. */
  searchEvents(request: SessionEventSearchRequest, signal?: AbortSignal): Promise<SessionEventSearchPage>
}

/** Native runtime options shared by exact-only and combined SQLite providers. */
export interface NativeSessionQueryRuntimeOptions extends Config {
  /** Shared state-fold registry for projection observations. */
  readonly projections?: NativeSessionProjectionOperations
  /** Matching durable projection rows used only as fold shortcuts. */
  readonly checkpointCache?: NativeSessionProjectionCacheOperations
  /** Selected full-text operations; absent operations report search-disabled. */
  readonly search?: NativeSessionQuerySearchOperations
}

/** Runtime returned to a Native Provider that owns query admission and projections. */
export interface NativeSessionQueryRuntime {
  /** Sole live-preferred query service for the selected composition. */
  readonly operations: SessionQueryOperations
  /** Stop exact-read admission, join accepted source reads, and release the turn-boundary fold. */
  close(): Promise<void>
}

/** Resolved per-provider limits used by the exact Native query implementation. */
export interface ResolvedNativeSessionQueryConfig {
  readonly readWindowMax: number
  readonly persistedReadConcurrency: number
  readonly preparedSessionCacheSize: number
}

const nativeConfigSchema = z.object({
  readWindowMax: z.number().int().nonnegative().default(SESSION_QUERY_READ_WINDOW_MAX),
  persistedReadConcurrency: z.number().int().positive().default(SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY),
  preparedSessionCacheSize: z.number().int().positive().default(SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE),
}).strict()

/**
 * Resolve Native query limits before service activation.
 * @param input - Native profile configuration.
 * @returns validated observation limits.
 */
export function resolveNativeSessionQueryConfig(input: unknown): ResolvedNativeSessionQueryConfig {
  try {
    return nativeConfigSchema.parse(input === undefined ? {} : input)
  } catch (cause: unknown) {
    throw new SessionQueryError('session-query: invalid Native query configuration', 'SESSION_QUERY_INVALID_CONFIG', { cause })
  }
}

/**
 * Build one exact query service over the same source supplied to the SQLite reconciler.
 * @param source - selected persistence and active-owner adapters.
 * @param options - projection, cache, and optional full-text operations.
 * @returns the exact query service and its close operation.
 */
export function createNativeSessionQueryRuntime(
  source: NativeSessionQuerySource,
  options: NativeSessionQueryRuntimeOptions = {},
): NativeSessionQueryRuntime {
  const config = resolveNativeSessionQueryConfig({
    readWindowMax: options.readWindowMax,
    persistedReadConcurrency: options.persistedReadConcurrency,
    preparedSessionCacheSize: options.preparedSessionCacheSize,
  })
  let unregisterTurnBoundary = options.projections?.register(turnBoundaryProjectionDefinition)
  const reader = new NativeSessionObservationReader(
    source,
    options.projections,
    options.checkpointCache,
    config.preparedSessionCacheSize,
  )
  const operations = new NativeSessionQuery(reader, config, options.search)
  return {
    operations,
    async close() {
      await reader.close()
      unregisterTurnBoundary?.()
      unregisterTurnBoundary = undefined
    },
  }
}

/** Native exact query operations backed by caller-owned observation leases. */
class NativeSessionQuery implements SessionQueryOperations {
  constructor(
    private readonly reader: NativeSessionObservationReader,
    private readonly config: ResolvedNativeSessionQueryConfig,
    private readonly search: NativeSessionQuerySearchOperations | undefined,
  ) {}

  /** @inheritdoc */
  observeSession(sessionId: SessionId, options?: SessionObservationOptions): Promise<SessionObservation> {
    return this.reader.read(sessionId, options)
  }

  /** @inheritdoc */
  searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>> {
    if (this.search === undefined) return Promise.reject(searchDisabled())
    return this.search.searchSessions(structuredClone(request), exec?.signal)
  }

  /** @inheritdoc */
  searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage> {
    if (this.search === undefined) return Promise.reject(searchDisabled())
    return this.search.searchEvents(structuredClone(request), exec?.signal)
  }

  /** @inheritdoc */
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    return this.reader.list(signal)
  }

  /** @inheritdoc */
  async readSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLogSnapshot> {
    return this.withObservation(sessionId, signal, observation => ({
      session: structuredClone(observation.header),
      inheritedEventCount: observation.inheritedEventCount,
      events: observation.events.map(snapshotSessionEvent),
    }))
  }

  /** @inheritdoc */
  async filterSessions(filters: readonly SessionResultFilter[], signal?: AbortSignal): Promise<SessionRecord[]> {
    const selected = materializeSessionResultFilters(filters)
    return filterSessionResults(await this.reader.list(signal), selected)
  }

  /** @inheritdoc */
  async readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined> {
    return (await this.readTitleSnapshot(sessionId, signal)).title
  }

  /** @inheritdoc */
  readTitleSnapshot(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleObservation> {
    return this.withObservation(sessionId, signal, observation => ({
      session: structuredClone(observation.header),
      ...foldTitle(observation.events),
    }))
  }

  /** @inheritdoc */
  async readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<SessionTitleObservationResult[]> {
    const ids = [...new Set(sessionIds)]
    const results = new Array<SessionTitleObservationResult>(ids.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const index = next++
        const sessionId = ids[index] as SessionId
        try {
          results[index] = { sessionId, status: 'fulfilled', value: await this.readTitleSnapshot(sessionId, signal) }
        } catch (reason: unknown) {
          if (signal?.aborted === true) return
          results[index] = { sessionId, status: 'rejected', reason }
        }
      }
    }
    const workers = Math.min(ids.length, this.config.persistedReadConcurrency)
    await Promise.allSettled(Array.from({ length: workers }, worker))
    signal?.throwIfAborted()
    return results
  }

  /** @inheritdoc */
  async listEvents(sessionId: SessionId): Promise<SessionEventRecord[]> {
    return this.withObservation(sessionId, undefined, observation => eventRecords(sessionId, observation.events))
  }

  /** @inheritdoc */
  async filterEvents(sessionId: SessionId, filters: readonly SessionEventResultFilter[]): Promise<SessionEventSearchDocument[]> {
    const selected = materializeSessionEventResultFilters(filters)
    return this.withObservation(sessionId, undefined, observation =>
      filterSessionEventDocuments(buildSessionEventSearchDocuments(sessionId, observation.events), selected))
  }

  /** @inheritdoc */
  async readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot> {
    return this.withObservation(sessionId, undefined, observation => ({
      session: structuredClone(observation.header),
      inheritedEventCount: observation.inheritedEventCount,
      capturedThroughSeq: observation.cursor < 0 ? null : SessionSeq(observation.cursor),
      events: currentSurfaceEvents(sessionId, observation.events),
    }))
  }

  /** @inheritdoc */
  async traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace> {
    return traceSession(await this.reader.list(signal), sessionId)
  }

  /** @inheritdoc */
  async traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation> {
    const { sessionId, seq } = request
    return this.withObservation(sessionId, signal, observation => ({
      session: structuredClone(observation.header),
      ...traceEvent(sessionId, observation.events, seq),
    }))
  }

  /** @inheritdoc */
  async readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow> {
    const { sessionId, seq } = request
    const before = readWindow('before', request.before, this.config.readWindowMax)
    const after = readWindow('after', request.after, this.config.readWindowMax)
    return this.withObservation(sessionId, signal, (observation) => {
      const target = observation.events[seq]
      if (target === undefined || target.seq !== seq) {
        throw new SessionQueryError(`session "${sessionId}" has no event at seq ${seq}`, 'SESSION_QUERY_EVENT_NOT_FOUND')
      }
      const startSeq = SessionSeq(Math.max(0, seq - before))
      const endSeq = SessionSeq(Math.min(observation.events.length - 1, seq + after))
      const targetSnapshot = snapshotSessionEvent(target)
      return {
        session: structuredClone(observation.header),
        inheritedEventCount: observation.inheritedEventCount,
        target: targetSnapshot,
        events: observation.events.slice(startSeq, endSeq + 1).map(event => event === target
          ? targetSnapshot
          : snapshotSessionEvent(event)),
        startSeq,
        endSeq,
      }
    })
  }

  private async withObservation<T>(
    sessionId: SessionId,
    signal: AbortSignal | undefined,
    read: (observation: SessionObservation) => T,
  ): Promise<T> {
    const observation = await this.reader.read(sessionId, {
      projectionMode: 'none',
      ...(signal === undefined ? {} : { signal }),
    })
    try {
      return read(observation)
    } finally {
      observation[Symbol.dispose]()
    }
  }
}

function foldTitle(events: readonly import('@deepseek-ai/dsh-session/native').SessionEvent[]): Pick<SessionTitleObservation, 'title'> {
  const title = foldSessionTitle(events)
  return title === undefined ? {} : { title }
}

function readWindow(name: 'before' | 'after', value: number | undefined, maximum: number): number {
  if (value === undefined) return 0
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new SessionQueryError(`${name} must be an integer between 0 and ${maximum}`, 'SESSION_QUERY_INVALID_WINDOW')
  }
  return value
}

function searchDisabled(): SessionQueryError {
  return new SessionQueryError('session query search is disabled', 'SESSION_QUERY_SEARCH_DISABLED')
}

/** Native exact-read Provider; a full-text backend may replace it as the sole `sessionQuery` Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-query',
  targets: ['host'],
  requires: ['activeSessions'],
  optional: ['sessionPersistence', 'sessionProjections', 'sessionProjectionCache'],
  provides: ['sessionQuery'],
  resolve(input) {
    const config = resolveNativeSessionQueryConfig(input)
    return (context) => {
      const source = createNativeSessionQuerySource(
        context.require('activeSessions'),
        context.optional('sessionPersistence'),
      )
      const projections = context.optional('sessionProjections')
      const checkpointCache = context.optional('sessionProjectionCache')
      const runtime = createNativeSessionQueryRuntime(source, {
        ...config,
        ...(projections === undefined ? {} : { projections }),
        ...(checkpointCache === undefined ? {} : { checkpointCache }),
      })
      context.own(() => runtime.close())
      context.provide('sessionQuery', runtime.operations)
    }
  },
}
