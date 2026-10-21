/**
 * Event-sourced Session object: append-only log and derived LLM message
 * history. The Cordis store owns publication and persistence coordination.
 *
 * @module @deepseek-ai/dsh-session/native
 */
import type { Message } from '@deepseek-ai/dsh-llm/native';
import { SessionLogOffset, SessionSeq } from './types.ts';
import type { EpochHeader, RequestContext, SessionEvent, SessionEventMap, SessionEventType, SessionHeader, SessionId, SessionSeedEventState, SurfaceIntent, SurfaceEventType } from './types.ts';
import type { SessionSurface } from './surface.ts';
export { adoptSessionEvent, snapshotSessionEvent } from './event-validation.ts';
export * from './types.ts';
export { SessionPreparation } from './preparation.ts';
export type { SessionPreparationOptions } from './preparation.ts';
export type { AssistantMessage, SystemMessage, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm/native';
export { interruptedTurnClosers, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from './repair.ts';
export type { SessionSurface, SurfaceFoldReplacement, SurfaceFoldResult } from './surface.ts';
export { deriveEventMessage, foldSurface, isAppendSurfaceEvent, isReplacementSurfaceEvent, isSurfaceEvent, isSurfaceEligibleType } from './surface.ts';
export { canonicalHeader, foldRequestHeader, headerEquals } from './request-header.ts';
export { KNOWN_SESSION_EVENT_TYPES } from './known-event-types.ts';
/** Options admitted with one event in a Session append batch. */
export type SessionAppendOptions<T extends SessionEventType> = T extends SurfaceEventType ? SurfaceIntent<T> : {
    readonly ignorable?: true;
    readonly sourceEventSeqs?: never;
    readonly surfaceOp?: never;
};
/** Typed input admitted with all other inputs before any batch event is published. */
export type SessionAppendInput = {
    [T in SessionEventType]: {
        readonly type: T;
        readonly data: SessionEventMap[T];
    } & (T extends SurfaceEventType ? {
        readonly opts: SessionAppendOptions<T>;
    } : {
        readonly opts?: SessionAppendOptions<T>;
    });
}[SessionEventType];
/** Store-owned publication hook; a detached Session has no hook. */
export interface SessionPublication {
    appending: boolean;
    announcing: boolean;
    detachRequested: boolean;
    detach(): void;
    capture(event: SessionEvent): () => void;
}
/**
 * Attach one store-owned publication route to a Session.
 * @param session - The live session.
 * @param publication - The store's event publication route.
 */
export declare function attachSessionPublication(session: Session, publication: SessionPublication): void;
/**
 * Remove one store-owned publication route from a Session.
 * @param session - The detached session.
 */
export declare function detachSessionPublication(session: Session): void;
/**
 * Whether a Session already has a store-owned publication route.
 * @param session - The session to inspect.
 * @returns Whether a route is attached.
 */
export declare function hasSessionPublication(session: Session): boolean;
/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
export declare class Session {
    private log;
    private readonly appendGuards;
    private checkingAppendGuards;
    /** Single incremental owner of surface acceptance and projection state. */
    private readonly surfaceManager;
    /** The ordered surface over this session's event log. */
    get surface(): SessionSurface;
    /**
     * Detached, deep-frozen creation metadata (format version, cwd, lineage,
     * and whether fork history exists). Supplied by the store via `ctx.sessions.create()`. When a
     * `Session` is created without a store-owned header, a minimal header is
     * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
     * `session.header` is always present. Kept out of the event log — it is a
     * storage concern, not replayable conversation state.
     */
    readonly header: SessionHeader;
    /** Number of leading events inherited from this Session's fork parent. */
    readonly inheritedEventCount: SessionLogOffset;
    /** The session identity, derived from its durable header's single copy. */
    get id(): SessionId;
    /**
     * The first seq appended IN THIS PROCESS: the length of the constructor
     * seed (0 without one). Events with smaller seq values entered through
     * construction — replay, fork, or resume — and were never published on the
     * `session/event` firehose (constructor seeds do not emit). This offset marks
     * the constructor-input boundary for lifecycle ownership and persistence
     * adoption; consumers that need complete canonical history still start at
     * seq 0. Distinct from {@link inheritedEventCount}, the DURABLE
     * fork-lineage cut: a resumed session's constructor seed is its full stored
     * log, while the inherited count keeps the original fork value — this field is the
     * in-process construction fact.
     *
     * Not persisted itself: a seeded session projects it into the log as the
     * `session/end-seed` event, which is what a consumer reading STORED history
     * reads. Locate the LAST such event, not necessarily one at this seq — a
     * seed already ending in one is not re-marked, so reopening an untouched
     * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
     * this field in-process: it is exact before the marker reaches storage.
     *
     * When this lifecycle appends the marker, it occupies this seq before the
     * store attaches and therefore does not publish either. Otherwise this seq
     * holds an ordinary published write.
     */
    readonly firstLiveSeq: SessionLogOffset;
    /**
     * Create a detached session by validating and snapshotting borrowed seed
     * events and storage metadata.
     * @param id - session identity.
     * @param seed - optional borrowed replay or fork events.
     * @param header - optional borrowed storage metadata.
     * @param inheritedEventCount - exact fork-inherited prefix length for a seeded header.
     * @param onConstructorEvent - receives a newly appended seed marker for persistence by the sole owner.
     * @returns a detached session.
     */
    static create(id: SessionId, seed?: readonly SessionEvent[], header?: SessionHeader, inheritedEventCount?: SessionLogOffset, onConstructorEvent?: (event: SessionEvent) => void): Session;
    /**
     * Restore a detached session by adopting an independently owned or deeply frozen seed.
     * Runtime-required event fields, event envelopes, sequence continuity, surface
     * transitions, and header fields are validated without copying or freezing events.
     * Embedded Assistant streams remain opaque until a stream consumer or storage
     * verifier reads them.
     * @param id - restored session identity.
     * @param seed - independently owned or deeply frozen events.
     * @param header - independently owned storage metadata.
     * @param inheritedEventCount - exact fork-inherited prefix length decoded from storage.
     * @param eventState - aliasing state carried from the operation that produced the seed.
     * @param onConstructorEvent - receives a resume marker appended during construction, if any.
     * @returns a restored detached session.
     */
    static fromRestore(id: SessionId, seed: readonly SessionEvent[], header: SessionHeader, inheritedEventCount: SessionLogOffset, eventState: SessionSeedEventState, onConstructorEvent?: (event: SessionEvent) => void): Session;
    private constructor();
    /** Cached immutable full snapshot of the private append-only log. */
    private eventsSnapshot;
    /**
     * Return the immutable event stored at one exact sequence number.
     * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
     * See the [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
     * @param seq - event sequence number.
     * @returns the accepted event, or undefined when the log does not contain it.
     */
    eventAt(seq: SessionSeq): SessionEvent | undefined;
    /**
     * Materialize an immutable snapshot of a half-open event sequence range.
     * A full current snapshot is reused until the next append; every previously
     * returned snapshot remains stable after later appends.
     * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
     * See the [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
     * @param fromSeq - non-negative inclusive sequence number; defaults to the log start.
     * @param toSeqExclusive - non-negative exclusive sequence number; defaults to the current end.
     * @returns a frozen array of the selected deeply frozen events.
     */
    snapshotEvents(fromSeq?: SessionLogOffset, toSeqExclusive?: SessionLogOffset): readonly SessionEvent[];
    /**
     * Return this Session's events after its fork-inherited prefix.
     * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
     * See the [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
     * @returns a fresh array containing child-owned events in log order.
     */
    ownEvents(): readonly SessionEvent[];
    /**
     * Whether one existing event position is outside the fork-inherited prefix.
     * @param seq - event position in this Session.
     * @returns true when the event belongs to this Session rather than its parent.
     */
    isOwnSeq(seq: SessionSeq): boolean;
    /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
    get seq(): SessionLogOffset;
    /**
     * Check whether this exact immutable event was accepted by this Session.
     * @param event - candidate event supplied to a synchronous policy projection.
     * @returns whether the log holds the same object at its assigned sequence.
     */
    hasAcceptedEvent(event: SessionEvent): boolean;
    /**
     * Register a synchronous veto before an event changes this Session's log.
     * Guards receive the validated immutable event and must not append recursively.
     * Historical restore events are not dispatched to guards.
     * @param guard - check that throws to reject an event without changing the log.
     * @returns exact registration disposer; removal is idempotent.
     */
    onBeforeAppend(guard: (event: SessionEvent) => void): () => void;
    /**
     * Append one typed event to the log and synchronously notify observers via
     * the store-owned, module-private publication hooks. The hot path never blocks
     * on I/O — persistence plugins buffer asynchronously. Once the event enters
     * the log, the append is committed: observer failures are logged and
     * contained per listener, so they do not change the return value or prevent
     * later listeners from observing the same accepted event.
     *
     * @param type - The event type (key of {@link SessionEventMap}).
     * @param data - The event payload; must be JSON-serializable.
     * @param opts - Surface metadata: `surfaceOp` controls how the event enters
     *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
     *   events this one derives from. REQUIRED for
     *   {@link SurfaceEventType} events (every message-producing event must
     *   declare how it joins the surface, the sole source of derived model
     *   history) and
     *   rejected by the compiler for non-surface types like `turn/start` or
     *   `assistant/attempt`. Assistant messages embed their exact provider
     *   stream and cannot cite top-level source events.
     * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
     *   `data` that entered the log, so reading `event.data` back sees the logged
     *   value, never the caller's still-mutable input.
     * @throws if `data` or surface metadata is not losslessly JSON-serializable
     *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
     *   circular reference, sparse array, or an exotic object such as
     *   Map/Set/Date/class instance), or when the candidate violates the
     *   request-header empty-field or tool-error consistency rules, or the
     *   canonical surface contract (marker shape and eligibility, unique
     *   earlier source-event references, positional replacement validity, and complete
     *   shadowed-node coverage). One iterative pass reads, validates, and
     *   copies each nested value once, so a stateful getter cannot supply one value
     *   to validation and another to storage. The event log is the durable source
     *   of truth, so a bad event fails at the append site rather than later during
     *   a backend flush. A synchronous internal dispatch validation failure or an
     *   append reentered while this acceptance/publication boundary is open also
     *   rejects before the log changes.
     */
    append<T extends SessionEventType>(type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []): SessionEvent<T>;
    /**
     * Admit related facts together after every payload, guard, surface transition and
     * publication callback has been validated. Guards observe the pre-batch log;
     * publication observers see the complete accepted batch in sequence order.
     * Persistence remains the selected writer's asynchronous durability barrier.
     * @param inputs - ordered typed facts and required surface metadata; a log-only event may set
     *   `ignorable: true` when older readers can safely skip it.
     * @returns immutable accepted events with contiguous sequences.
     * @throws before changing the log if any input or synchronous acceptance check fails.
     */
    appendBatch(inputs: readonly SessionAppendInput[]): readonly SessionEvent[];
    /** Cached fold of the request-header events — see {@link requestHeader}. */
    private headerFold;
    /** Log position (events consumed) the header fold has reached. */
    private headerFoldSeq;
    /**
     * The {@link EpochHeader} in force after the log's last header event — the
     * header the NEXT request will be compared against — or undefined before
     * the first `request/header` snapshot. The live, incrementally-maintained
     * form of `foldRequestHeader(session.snapshotEvents())`: each header event is folded
     * once, when first seen, so a per-step read costs O(new events).
     * @returns the folded header, or undefined when no header event exists yet.
     */
    requestHeader(): EpochHeader | undefined;
    /** Cached fold of `request/context` events. */
    private contextFold;
    private contextFoldSeq;
    /**
     * Return the latest resolved route metadata, or `undefined` before the first
     * `request/context` event. Each event is folded once.
     * @returns the latest immutable route metadata.
     */
    requestContext(): RequestContext | undefined;
    /** The derived-message cache: frozen projections, extended per unseen node. */
    private derived;
    /** Surface position (nodes projected) the cache has reached. */
    private derivedNodes;
    /** {@link SurfaceManager.replaceGeneration} the cache was built under. */
    private derivedGeneration;
    /**
     * Derive the LLM message history by walking the ordered sequences of
     * message-producing events maintained by `surfaceOp` markers. The
     * surface is the single source of derived history: every message-producing
     * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
     * turn boundary) is correctly absent, and a compaction `replace` deletes the
     * shadowed nodes from the derivation. The projection rules are
     * {@link deriveEventMessage}, folded per node.
     *
     * CACHED: each surface node is projected exactly once, when first seen — a
     * call costs O(new nodes), and a surface rewrite (a `replace`;
     * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
     * a fresh snapshot per call (later appends never grow an array a caller
     * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
     * Their content reuses the already frozen durable event data, so the cache
     * needs no second deep clone and consumers still cannot mutate the log.
     * @returns a fresh array of the shared, frozen derived history.
     */
    deriveMessages(): Message[];
    /**
     * Instance face of the pure per-node `deriveEventMessage` export from
     * `surface.ts`.
     * @param event - the event to project.
     * @returns the derived message, or null when the event produces none.
     */
    deriveEventMessage(event: SessionEvent): Message | null;
}
/** A fork source: either the live session object or its live store id. */
export type SessionForkSource = Session | SessionId;
/**
 * Rejection codes for session forking: the fork source id is unknown to the
 * live store (`SESSION_NOT_FOUND`) or names a session object that is not the
 * store's live instance (`SESSION_NOT_LIVE`); the requested child id is
 * already taken (`SESSION_ALREADY_EXISTS`); the boundary is not a contiguous
 * existing seq (`INVALID_BOUNDARY`); or the selected prefix ends inside an
 * open turn (`OPEN_TURN`).
 */
export type SessionForkErrorCode = 'SESSION_NOT_FOUND' | 'SESSION_NOT_LIVE' | 'SESSION_ALREADY_EXISTS' | 'INVALID_BOUNDARY' | 'OPEN_TURN';
/** Typed error for session fork rejections. */
export declare class SessionForkError extends Error {
    readonly code: SessionForkErrorCode;
    constructor(message: string, code: SessionForkErrorCode);
}
export { decodeSeqRanges, encodeSeqRanges } from './seq-ranges.ts';
//# sourceMappingURL=session-core.d.ts.map