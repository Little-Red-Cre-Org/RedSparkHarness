/** Cordis SessionStore and scoped event publication over the shared Session object. */
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-typert-protocol/types'
import type { TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import { SESSION_FORMAT_VERSION, SessionLogOffset, SessionSeq } from './types.ts'
import type { CreateSessionOptions, PrepareSessionOptions, SessionEvent, SessionId, SessionHeader } from './types.ts'
import { Session, SessionForkError, attachSessionPublication, detachSessionPublication, hasSessionPublication, type SessionForkSource } from './session-core.ts'
export * from './native.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionStore
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
    'session/created'(this: Scoped<Session>, session: Session): void
    /**
     * Emitted once when an announced session leaves the store, including
     * publication rollback, but never for an entry whose creation announcement
     * did not begin. Listener failures are logged and contained.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
     * @param session - the session that is no longer live in the store.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'session/disposed'(this: Scoped<Session>, session: Session): void
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
    'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
    /**
     * Awaited parallel durability checkpoint: every listener runs and the
     * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
     * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
     * @param session - the session whose buffered events must reach durable storage.
     * @dshScopeScan unsupported
     * @mode parallel
     */
    'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    session: TypertLookup<Session, SessionId>
  }
}

declare module '@deepseek-ai/dsh-typert-protocol/types' {
  interface RemoteErrorDetailsMap {
    /** The named Session does not exist; produced by every layer that resolves a SessionId. */
    'session/not-found': { readonly sessionId: SessionId }
  }
}

type SessionCallback = (...args: unknown[]) => unknown

/** Resolve one listener snapshot, including Cordis's internal dispatch checks. */
function collectSessionCallbacks(ctx: Context, args: unknown[]): SessionCallback[] {
  return [...ctx.events.dispatch('emit', args)] as SessionCallback[]
}

/** Invoke one resolved observe-only listener snapshot with per-listener containment. */
function invokeContainedSessionObservers(
  ctx: Context,
  name: 'session/event' | 'session/disposed',
  id: SessionId,
  args: unknown[],
  callbacks: SessionCallback[],
): void {
  for (const callback of callbacks) {
    try {
      const returned: unknown = callback(...args)
      void Promise.resolve(returned).catch((error: unknown) => {
        ctx.logger.warn(`session "${id}": ${name} listener rejected: ${String(error)}`)
      })
    } catch (error: unknown) {
      ctx.logger.warn(`session "${id}": ${name} listener threw: ${String(error)}`)
    }
  }
}

/** All mutable lifecycle state for one exact store entry. */
interface SessionEntry {
  readonly id: SessionId
  readonly session: Session
  readonly carrier: Scoped<Session>
  readonly emitCtx: Context
  announced: boolean
  announcing: boolean
  appending: boolean
  detachRequested: boolean
  detach(): void
  capture(event: SessionEvent): () => void
}

/**
 * In-memory session store (`ctx.sessions`).
 *
 * Persistence is intentionally not implemented here — the agent lifecycle
 * attaches a session-log writer to each published session's write handle;
 * a session published outside that lifecycle persists nothing.
 */
export class SessionStore extends Service {
  private store = new Map<SessionId, SessionEntry>()
  private counter = 0

  constructor(ctx: Context) {
    super(ctx, 'sessions')
    ctx.inject(['typert'], (typeCtx) => {
      typeCtx.typert.lookups.register('session', {
        parameter: 'session',
        wire: 'sessionId',
        hostTypeSymbol: '@deepseek-ai/dsh-session#Session',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: sessionId => this.get(sessionId),
      })
    })
  }

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
  create(id?: SessionId, options?: CreateSessionOptions): Session {
    const session = this.prepare(id, options)
    // Single effect owned by the calling fiber. Yield the detach BEFORE
    // announcing so a throwing `session/created` listener rolls the attach back
    // (the generator effect disposes already-yielded disposers on a throw)
    // instead of leaking the store entry and its publication hooks.
    this.ctx.effect(function* (this: SessionStore) {
      yield this.enter(session)
      this.announce(session)
    }.bind(this), 'sessions.create()')
    return session
  }

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
  prepare(id?: SessionId, options?: PrepareSessionOptions): Session {
    let sessionId: SessionId
    if (id === undefined) {
      do sessionId = brandString<SessionId>(`session-${++this.counter}`)
      while (this.store.has(sessionId))
    } else {
      sessionId = brandString<SessionId>(id)
    }
    if (this.store.has(sessionId)) throw new Error(`session "${sessionId}" already exists`)
    if (options !== undefined) {
      const { eventState } = options
      switch (eventState) {
        case 'detached':
        case 'shared-frozen':
          return Session.fromRestore(
            sessionId,
            options.seed,
            options.meta,
            options.inheritedEventCount,
            eventState,
          )
        case undefined:
          break
        /* v8 ignore next -- closed-union exhaustiveness guard */
        default:
          assertNever(eventState, 'SessionStore.prepare event state')
      }
    }
    const seed = options?.seed
    const meta = options?.meta
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: meta?.createdAt ?? Date.now(),
      ...meta?.cwd === undefined ? {} : { cwd: meta.cwd },
      ...meta?.parentSession === undefined ? {} : { parentSession: meta.parentSession },
      isSeeded: meta?.isSeeded ?? false,
      ...meta?.origin === undefined ? {} : { origin: meta.origin },
      ...meta?.delegationDepth === undefined ? {} : { delegationDepth: meta.delegationDepth },
      ...meta?.agentPreset === undefined ? {} : { agentPreset: meta.agentPreset },
    }
    return Session.create(sessionId, seed, header, options?.inheritedEventCount)
  }

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
  enter(session: Session): () => void {
    const id = session.id
    const carrier = scopeTarget(session, scopeOf(this.ctx))
    // This is the authoritative collision boundary after arbitrary unpublished
    // preparation. Only one exact same-id transaction can publish.
    if (this.store.has(id)) throw new Error(`session "${id}" already exists`)
    if (hasSessionPublication(session)) throw new Error(`session "${id}" is already attached to a store`)
    const entry: SessionEntry = {
      id,
      session,
      carrier,
      emitCtx: this.ctx,
      announced: false,
      announcing: false,
      appending: false,
      detachRequested: false,
      detach: () => { this.detachEntered(entry) },
      capture: (event: SessionEvent): (() => void) => {
        const callbackArgs: unknown[] = [session, event]
        const callbacks = collectSessionCallbacks(this.ctx, [carrier, 'session/event', ...callbackArgs])
        return () => { invokeContainedSessionObservers(this.ctx, 'session/event', id, callbackArgs, callbacks) }
      },
    }
    this.store.set(id, entry)
    attachSessionPublication(session, entry)
    let entered = true
    const detach = (): void => {
      if (!entered) return
      entered = false
      // A lifecycle listener may own the advanced detach capability. Keep the
      // entry and its publication hooks live until synchronous creation or append
      // publication unwinds, then publish the paired disposal edge.
      if (entry.announcing || entry.appending) {
        entry.detachRequested = true
        return
      }
      entry.detach()
    }
    return detach
  }

  /** Remove one exact entered session and emit its paired disposal when announced. */
  private detachEntered(entry: SessionEntry): void {
    entry.detachRequested = false
    // A stale capability cannot remove observers or storage belonging to a
    // later same-id lifecycle.
    /* v8 ignore next -- enter() rejects replacement while this single-shot detach capability is live. */
    if (this.store.get(entry.id) !== entry) return
    this.store.delete(entry.id)
    detachSessionPublication(entry.session)
    if (entry.announced) this.emitDisposed(entry)
  }

  /** Emit `session/created` exactly once for an {@link enter}ed session (with
   * the carrier {@link enter} captured). Separate from {@link enter} so the
   * caller can yield the detach disposer first (rollback safety — see
   * {@link enter}).
   * @param session - the entered session to announce to listeners.
   * @throws if the session is not live or its announcement already began,
   *   including a reentrant call from a creation listener. */
  announce(session: Session): void {
    const entry = this.liveEntryFor(session)
    if (entry.announced || entry.announcing) {
      throw new Error(`session "${entry.id}" was already announced`)
    }
    // Mark before emit: Cordis emit may deliver to earlier listeners and then
    // throw. Rollback must still pair that partial creation with disposal, and
    // a listener cannot recursively create a second lifecycle edge.
    entry.announced = true
    const callbackArgs: unknown[] = [session]
    entry.announcing = true
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/created', session])
      for (const callback of callbacks) {
        // Synchronous throws intentionally propagate and veto publication; the
        // yielded detach then emits the paired disposal edge. An async function
        // is nevertheless assignable to a void listener, so observe its returned
        // promise: rejection is too late to roll back and must be logged instead
        // of becoming unhandled.
        const returned: unknown = callback(...callbackArgs)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`session "${entry.id}": session/created listener rejected: ${String(error)}`)
        })
      }
    } finally {
      entry.announcing = false
      if (entry.detachRequested && !entry.appending) entry.detach()
    }
  }

  /** Emit the paired teardown notification with per-listener containment. */
  private emitDisposed(entry: SessionEntry): void {
    const callbackArgs: unknown[] = [entry.session]
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/disposed', entry.session])
      invokeContainedSessionObservers(this.ctx, 'session/disposed', entry.id, callbackArgs, callbacks)
    } catch (error: unknown) {
      this.ctx.logger.warn(`session "${entry.id}": session/disposed dispatch threw: ${String(error)}`)
    }
  }

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
  async flush(session: Session): Promise<boolean> {
    const { carrier } = this.liveEntryFor(session)
    const callbackArgs: unknown[] = [session]
    const callbacks = collectSessionCallbacks(this.ctx, [carrier, 'session/flush', session])
    const results = await Promise.allSettled(callbacks.map((callback) => {
      try {
        return callback(...callbackArgs)
      } catch (error: unknown) {
        // Preserve the listener's exact rejection value; flush is a caller-owned
        // failure boundary, and Cordis listeners may throw arbitrary values.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        return Promise.reject(error)
      }
    }))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure !== undefined) throw failure.reason
    return callbacks.length > 0
  }

  /** Return the exact live entry; detached/prepared objects reject. */
  private liveEntryFor(session: Session): SessionEntry {
    const entry = this.store.get(session.id)
    if (entry?.session !== session || !hasSessionPublication(session)) {
      throw new Error(`session "${session.id}" is not live in this store`)
    }
    return entry
  }

  /**
   * Look up a live session.
   * @param id - the session id to look up.
   * @returns the session, or undefined when no live session has that id.
   */
  get(id: SessionId): Session | undefined {
    return this.store.get(id)?.session
  }

  /**
   * All live sessions, in creation order.
   * @returns a fresh array; mutating it does not affect the store.
   */
  list(): Session[] {
    return [...this.store.values()].map(entry => entry.session)
  }

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
  fork(source: SessionForkSource, boundary?: SessionSeq, childSessionId?: SessionId): Session {
    if (childSessionId !== undefined && this.get(childSessionId) !== undefined) {
      throw new SessionForkError(`session "${childSessionId}" already exists`, 'SESSION_ALREADY_EXISTS')
    }
    const liveSource = this._resolveForkSource(source)
    const seed = this._forkSeed(liveSource, boundary)
    return this.create(childSessionId, {
      seed,
      inheritedEventCount: SessionLogOffset(seed.length),
      meta: {
        ...liveSource.header.cwd !== undefined ? { cwd: liveSource.header.cwd } : {},
        parentSession: liveSource.id,
        isSeeded: true,
      },
    })
  }

  private _forkSeed(session: Session, requestedBoundary: SessionSeq | undefined): readonly SessionEvent[] {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const lastEvent = session.snapshotEvents().at(-1)
    let boundary: SessionSeq
    if (requestedBoundary !== undefined) {
      boundary = requestedBoundary
    } else {
      if (lastEvent === undefined) return []
      boundary = lastEvent.seq
    }
    if (!Number.isSafeInteger(boundary) || boundary < 0) {
      throw new SessionForkError(
        `fork boundary for session "${session.id}" must be a non-negative safe integer, got ${String(boundary)}`,
        'INVALID_BOUNDARY',
      )
    }
    if (boundary >= session.seq) {
      const lastSeq = lastEvent?.seq
      throw new SessionForkError(
        `fork boundary ${boundary} does not exist in session "${session.id}" (last seq: ${lastSeq ?? 'none'})`,
        'INVALID_BOUNDARY',
      )
    }

    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const boundaryEvent = session.eventAt(boundary)
    if (boundaryEvent === undefined || boundaryEvent.seq !== boundary) {
      throw new SessionForkError(
        `fork boundary ${boundary} does not match a contiguous event seq in session "${session.id}"`,
        'INVALID_BOUNDARY',
      )
    }
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = session.snapshotEvents(SessionLogOffset(0), SessionLogOffset(boundary + 1))
    const lastTurnBoundary = events
      .findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
    if (lastTurnBoundary?.type === 'turn/start') {
      throw new SessionForkError(
        `fork boundary ${boundary} in session "${session.id}" ends inside open turn ${lastTurnBoundary.data.turn}`,
        'OPEN_TURN',
      )
    }

    return events
  }

  private _resolveForkSource(source: SessionForkSource): Session {
    if (typeof source === 'string') {
      const session = this.get(source)
      if (session === undefined) throw new SessionForkError(`session "${source}" not found`, 'SESSION_NOT_FOUND')
      return session
    }

    const live = this.get(source.id)
    if (live === undefined) {
      throw new SessionForkError(`session "${source.id}" not found`, 'SESSION_NOT_FOUND')
    }
    if (live !== source) throw new SessionForkError(`session "${source.id}" is not the live store instance`, 'SESSION_NOT_LIVE')
    return source
  }

}

export default SessionStore
