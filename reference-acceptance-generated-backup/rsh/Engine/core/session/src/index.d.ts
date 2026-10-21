/** Cordis SessionStore and scoped event publication over the shared Session object. */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Scoped } from '@deepseek-ai/dsh-scope';
import type { TypertLookup } from '@deepseek-ai/dsh-typert-protocol';
import { SessionSeq } from './types.ts';
import type { CreateSessionOptions, PrepareSessionOptions, SessionEvent, SessionId } from './types.ts';
import { Session, type SessionForkSource } from './session-core.ts';
export * from './native.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessions: SessionStore;
    }
    interface Events {
        /**
         * Creation announcement during session publication. A synchronous throw vetoes and rolls
         * back with a paired disposal; detach requested during dispatch is deferred.
         * A returned-promise rejection is logged but cannot retroactively veto this
         * synchronous boundary.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
         * receive only sessions entered through that agent's context.
         * @param session - the session just entered and announced.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'session/created'(this: Scoped<Session>, session: Session): void;
        /**
         * Emitted once when an announced session leaves the store, including
         * publication rollback, but never for an entry whose creation announcement
         * did not begin. Listener failures are logged and contained.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
         * @param session - the session that is no longer live in the store.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'session/disposed'(this: Scoped<Session>, session: Session): void;
        /**
         * Post-commit, fire-and-forget append feed. The listener snapshot resolves
         * before the log push, but callbacks run after it; observer failures are
         * logged and contained without making the committed append fail.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
         * receive only events from sessions entered through that agent's context.
         * @param session - the session whose log grew.
         * @param event - the appended event, exactly as recorded.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void;
        /**
         * Awaited parallel durability checkpoint: every listener runs and the
         * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
         * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
         * @param session - the session whose buffered events must reach durable storage.
         * @dshScopeScan unsupported
         * @mode parallel
         */
        'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void;
    }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertLookupMap {
        session: TypertLookup<Session, SessionId>;
    }
}
declare module '@deepseek-ai/dsh-typert-protocol/types' {
    interface RemoteErrorDetailsMap {
        /** The named Session does not exist; produced by every layer that resolves a SessionId. */
        'session/not-found': {
            readonly sessionId: SessionId;
        };
    }
}
/**
 * In-memory session store (`ctx.sessions`).
 *
 * Persistence is intentionally not implemented here — the agent lifecycle
 * attaches a session-log writer to each published session's write handle;
 * a session published outside that lifecycle persists nothing.
 */
export declare class SessionStore extends Service {
    private store;
    private counter;
    constructor(ctx: Context);
    /**
     * Create a session owned by the calling fiber: disposing that fiber stops
     * event notification and removes the session from the store. `options.seed`
     * populates the session with a copy of those events (replay/fork);
     * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
     * and parent lineage, and delegation depth) as the immutable
     * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
     *
     * For an agent whose session must be torn down IN ORDER with its loop (so the
     * loop's final events are published before the store attachment ends), do NOT use this
     * — fold the session lifecycle into the agent's own effect via
     * {@link prepare} + {@link enter} + {@link announce} (see
     * `dsh-agent-loop`'s creation transaction).
     *
     * @param id - the session id; omitted, the store mints `session-<n>`.
     * @param options - seed events and/or creation metadata for the header.
     * @returns the live session, already entered and announced.
     * @throws if a session with `id` already exists, metadata is not a plain
     *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
     *   non-absolute path (storage backends key directories off it).
     */
    create(id?: SessionId, options?: CreateSessionOptions): Session;
    /**
     * Build a session WITHOUT entering it into the store — validate the id/cwd and
     * construct the {@link Session} (with its immutable {@link SessionHeader}).
     * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
     * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
     * effect so a fiber unload tears the session + agent down as a single ORDERED
     * chain rather than as racing sibling effects — which would remove the publication hooks
     * before the driver's closing events commit, dropping them.
     *
     * @param id - the session id; omitted, the store mints `session-<n>`.
     * @param options - seed events and/or creation metadata for the header. With
     *   `eventState`, every seed event is either independently owned or any
     *   shared value is deeply frozen; {@link Session.fromRestore} validates and
     *   adopts those values without copying or freezing them.
     * @returns the constructed session, NOT yet in the store.
     * @throws if a session with `id` already exists, metadata is not a plain
     *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
     *   non-absolute path.
     */
    prepare(id?: SessionId, options?: PrepareSessionOptions): Session;
    /**
     * Enter a {@link prepare}d session into the store: install the module-private
     * append publication hooks and add it to the store. Returns the DETACH
     * disposer (hooks + store removal). Does NOT emit `session/created` —
     * the caller yields this disposer inside its effect and THEN calls
     * {@link announce}, so a throwing `session/created` listener rolls the attach
     * back instead of leaking it.
     *
     * Re-checks the id for a duplicate: `prepare` and `enter` are public
     * cross-package primitives and a caller may interleave arbitrary work (or
     * another create) between them, so a stale prepared session must NOT overwrite
     * a live store entry of the same id — its detach disposer would later delete
     * the REAL session. The {@link create} convenience and the agent factory call
     * the two back-to-back so they never trip this, but the public API cannot
     * assume that.
     *
     * @param session - a {@link prepare}d session not yet in the store.
     * @returns the detach disposer (publication hooks + store removal). When called from
     *   a synchronous `session/created` listener, removal and disposal wait until
     *   that creation dispatch unwinds.
     * @throws if a session with this id is already in the store.
     */
    enter(session: Session): () => void;
    /** Remove one exact entered session and emit its paired disposal when announced. */
    private detachEntered;
    /** Emit `session/created` exactly once for an {@link enter}ed session (with
     * the carrier {@link enter} captured). Separate from {@link enter} so the
     * caller can yield the detach disposer first (rollback safety — see
     * {@link enter}).
     * @param session - the entered session to announce to listeners.
     * @throws if the session is not live or its announcement already began,
     *   including a reentrant call from a creation listener. */
    announce(session: Session): void;
    /** Emit the paired teardown notification with per-listener containment. */
    private emitDisposed;
    /**
     * Dispatch the awaited `session/flush` durability checkpoint for `session`,
     * with the carrier captured at {@link enter}. THE flush entry point: the
     * store owns the carrier, so callers (the checkpoint policy's per-request
     * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
     * that flush themselves before reading storage) must come through here
     * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
     * one spelling, and the scoped-dispatch invariant can pin it.
     * @param session - the session whose buffered events must reach durable storage.
     * @returns whether at least one durability listener participated, after every
     *   listener has settled successfully.
     * @throws the first registered listener failure after every listener settles.
     */
    flush(session: Session): Promise<boolean>;
    /** Return the exact live entry; detached/prepared objects reject. */
    private liveEntryFor;
    /**
     * Look up a live session.
     * @param id - the session id to look up.
     * @returns the session, or undefined when no live session has that id.
     */
    get(id: SessionId): Session | undefined;
    /**
     * All live sessions, in creation order.
     * @returns a fresh array; mutating it does not affect the store.
     */
    list(): Session[];
    /**
     * Create a live child session from a stable prefix of a live source.
     * `boundary` is an inclusive source event seq; omitted means the source's
     * current last event. The selected slice may end with a between-turn event
     * but must not end inside an open turn.
     *
     * @param source - Live source session object or id.
     * @param boundary - Inclusive source event seq to fork through; omitted means
     *   the source's current last event, and omitted on an empty source forks an
     *   empty child.
     * @param childSessionId - Optional child session id; omitted delegates to
     *   `SessionStore`'s id policy.
     * @returns The created live child session.
     */
    fork(source: SessionForkSource, boundary?: SessionSeq, childSessionId?: SessionId): Session;
    private _forkSeed;
    private _resolveForkSource;
}
export default SessionStore;
//# sourceMappingURL=index.d.ts.map