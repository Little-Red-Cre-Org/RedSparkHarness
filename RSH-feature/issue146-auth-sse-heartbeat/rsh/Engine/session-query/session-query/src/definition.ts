/** Cordis-free Definition shared by Cordis and Native session-query Providers. */

import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title/native'
import type { SessionObservation, SessionObservationOptions } from './types.ts'
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

/** Full logical-corpus service implemented by exactly one selected Provider. */
export interface SessionQueryOperations {
  /**
   * Observe one exact live or prepared Session without a persistence listing preflight.
   * @param sessionId - logical Session identity.
   * @param options - cancellation and projection selection.
   * @returns a caller-owned observation lease.
   */
  observeSession(sessionId: SessionId, options?: SessionObservationOptions): Promise<SessionObservation>
  /**
   * Search the live-preferred logical corpus and group by session.
   * @param request - query text, filters, page size, and cursor.
   * @param exec - optional cancellation control.
   * @returns session hits ranked by their strongest matching event.
   */
  searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>
  /**
   * Search events within one live-preferred logical session.
   * @param request - target session, query text, filters, page size, and cursor.
   * @param exec - optional cancellation control.
   * @returns matching events and their target header from one index generation.
   */
  searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage>
  /**
   * List the complete logical corpus using live-preferred records.
   * @param signal - optional cancellation for persistence listing.
   * @returns deterministic newest-first cloned session records.
   */
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  /**
   * Read one complete logical session without making it live. Detached logs are replay-validated;
   * live history comes from the active owner's validated resident Session.
   * @param sessionId - live or persisted session id to read.
   * @param signal - optional cancellation for source resolution and reading.
   * @returns cloned header and complete raw event log from one observation.
   */
  readSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLogSnapshot>
  /**
   * Filter the complete logical corpus with provider-independent predicates.
   * @param filters - ANDed session metadata and availability clauses.
   * @param signal - optional cancellation for persistence listing.
   * @returns matching cloned records in deterministic newest-first order.
   */
  filterSessions(filters: readonly SessionResultFilter[], signal?: AbortSignal): Promise<SessionRecord[]>
  /**
   * Read only the latest log-backed title.
   * @param sessionId - live or persisted session id to read.
   * @param signal - optional cancellation for source resolution.
   * @returns the latest title snapshot, or `undefined` when absent.
   */
  readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>
  /**
   * Read the latest log-backed title together with its source header.
   * @param sessionId - live or persisted session id to read.
   * @param signal - optional cancellation for source resolution.
   * @returns the source header and optional title snapshot.
   */
  readTitleSnapshot(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleObservation>
  /**
   * Read titles for unique sessions in first-occurrence order, isolating per-session failures.
   * @param sessionIds - logical session ids to observe.
   * @param signal - optional cancellation shared by all source reads.
   * @returns one fulfilled or rejected result per unique requested id.
   */
  readTitleSnapshots(sessionIds: readonly SessionId[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]>
  /**
   * List lightweight event records in ascending sequence order.
   * @param sessionId - live-preferred session id to read.
   * @returns one record per raw event.
   */
  listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>
  /**
   * Scan semantic event documents with provider-independent filters.
   * @param sessionId - live-preferred session id to scan.
   * @param filters - ANDed metadata and literal-text predicates.
   * @returns matching semantic documents in ascending sequence order.
   */
  filterEvents(sessionId: SessionId, filters: readonly SessionEventResultFilter[]): Promise<SessionEventSearchDocument[]>
  /**
   * Read the complete current model surface from one corpus observation.
   * @param sessionId - live-preferred session id to read.
   * @returns cloned header, surface, and captured raw-log watermark.
   */
  readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>
  /**
   * Trace known ancestry and descendants from one corpus observation.
   * @param sessionId - logical session id to trace.
   * @param signal - optional cancellation for persistence listing.
   * @returns complete lineage or the first unresolved parent.
   */
  traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace>
  /**
   * Trace one event's direct positional replacements and cited source events.
   * @param request - target session id and event sequence.
   * @param signal - optional cancellation for source resolution.
   * @returns source header, direct links, and positional replacement chain.
   */
  traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation>
  /**
   * Read one full event and a bounded raw-log context window.
   * @param request - target session/sequence and context sizes.
   * @param signal - optional cancellation for source resolution.
   * @returns cloned target and neighboring raw events.
   */
  readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>
}
