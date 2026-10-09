/**
 * Framework-free session-title behavior shared by the Cordis service and the
 * native Consumer: provider registration and teardown, per-session revisions
 * and supersession, provider cadence, route-gated automatic generation, the
 * deterministic fallback, explicit rename and refresh, and result acceptance.
 * Each runtime supplies a {@link SessionTitleTarget} over its own Session
 * reads and sole writer, and forwards the durable events it observes.
 *
 * @module @deepseek-ai/dsh-session-title/engine
 */

import type { Session } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent, SessionEventMap, SessionSeq } from '@deepseek-ai/dsh-session/types'
import {
  sessionTitleUserMessageOf,
  validateSessionTitleResult,
  type SessionTitleAutomaticMode,
  type SessionTitleConfig,
  type SessionTitleProviderId,
  type SessionTitleProviderResult,
} from './facts.ts'
import { fallbackSessionTitle, normalizeSessionTitle } from './normalize.ts'
import type { SessionTitleModelProvenance, SessionTitleSnapshot, SessionTitleUserMessage, TitleInputState } from './types.ts'

/**
 * Rejection of an explicit user title whose text normalizes to empty — the
 * one rename failure that blames the input. Callers translating rename
 * failures onto a wire (`title-invalid`) narrow on this class; liveness and
 * disposal failures stay plain `Error`s.
 */
export class SessionTitleInvalidError extends Error {
  override readonly name = 'SessionTitleInvalidError'
}

/** Immutable input supplied to one title-provider call. */
export interface SessionTitleProviderRequest {
  /** Live session being titled. */
  readonly session: Session
  /** All eligible human messages through this generation revision. */
  readonly messages: readonly SessionTitleUserMessage[]
  /** Exact current logged main-request route, when one has been recorded. */
  readonly route?: SessionTitleModelProvenance
  /** Cancellation for supersession, disposal, timeout composition, or the explicit caller. */
  readonly signal: AbortSignal
}

/** Title implementation contract shared by both runtimes; `R` is the runtime's request shape. */
export interface SessionTitleEngineProvider<R extends SessionTitleProviderRequest = SessionTitleProviderRequest> {
  /** Stable id of the provider recorded with the title. */
  readonly id: SessionTitleProviderId
  /** When new human prompts start automatic generation. */
  readonly automatic: SessionTitleAutomaticMode
  /**
   * Produce one title revision.
   * @param request - message snapshot, current route, session, and cancellation.
   * @returns proposed title plus exact input seqs and the optional provider/model route used to generate it.
   */
  generate(request: R): Promise<SessionTitleProviderResult>
}

/** One runtime's reads and sole-writer access for one live Session. */
export interface SessionTitleTarget {
  /** Live Session: id, header, and current request header. */
  readonly session: Session
  /** Latest folded title. */
  title(): SessionTitleSnapshot | undefined
  /** Folded eligible-input facts. */
  input(): TitleInputState
  /**
   * Eligible human messages through one seq.
   * @param throughSeq - inclusive upper bound.
   * @param signal - cancellation of the read.
   */
  messages(throughSeq: SessionSeq, signal: AbortSignal): readonly SessionTitleUserMessage[] | Promise<readonly SessionTitleUserMessage[]>
  /** Whether this target may still write. */
  live(): boolean
  /**
   * Append one accepted title through the sole writer and fold it.
   * @param data - accepted title event.
   */
  commit(data: SessionEventMap['session/title']): void
  /** Persist appended events, when the runtime defers persistence. */
  persist?(): Promise<void>
  /** Keep the Session open while a provider call runs; returns the release. */
  hold?(): () => void
}

/** Service lifetime and diagnostics supplied by the runtime glue. */
export interface SessionTitleEngineHost {
  /** Whether the owning service can still start or commit title work. */
  active(): boolean
  /**
   * Report a non-fatal background failure.
   * @param message - diagnostic text.
   */
  warn(message: string): void
}

/** One exact provider registration generation. */
interface ProviderRegistration<R extends SessionTitleProviderRequest> {
  readonly provider: SessionTitleEngineProvider<R>
  readonly active: Set<Promise<unknown>>
  closing: boolean
}

/** Automatic work waiting for the matching main-request route. */
interface PendingAutomaticWork<R extends SessionTitleProviderRequest> {
  readonly registration: ProviderRegistration<R>
  readonly revision: number
  readonly throughSeq: SessionSeq
}

/** Provider call currently allowed to commit for one session. */
interface ActiveProviderWork<R extends SessionTitleProviderRequest> extends PendingAutomaticWork<R> {
  readonly controller: AbortController
  readonly signal: AbortSignal
}

/** Mutable concurrency state scoped to one live session. */
interface SessionTitleWorkState<R extends SessionTitleProviderRequest> {
  revision: number
  readonly operations: Set<Promise<unknown>>
  closing?: boolean
  fallback?: Promise<SessionTitleSnapshot | undefined>
  pending?: PendingAutomaticWork<R>
  active?: ActiveProviderWork<R>
}

/**
 * Extend the shared request with runtime-only authority.
 * @param base - shared request.
 * @param target - Session target of the call.
 * @param guard - throws when the call is no longer current.
 */
export type SessionTitleRequestBuilder<T extends SessionTitleTarget, R extends SessionTitleProviderRequest>
  = (base: SessionTitleProviderRequest, target: T, guard: () => void) => R

/** Shared session-title orchestration over runtime-supplied targets. */
export class SessionTitleEngine<T extends SessionTitleTarget, R extends SessionTitleProviderRequest = SessionTitleProviderRequest> {
  private registration: ProviderRegistration<R> | undefined
  private readonly work = new Map<T, SessionTitleWorkState<R>>()
  private readonly lifetime = new AbortController()
  private readonly inFlight = new Set<Promise<unknown>>()

  /**
   * @param config - validated fallback and acceptance limits.
   * @param host - service lifetime and diagnostics.
   * @param buildRequest - runtime extension of the provider request.
   */
  constructor(
    private readonly config: SessionTitleConfig,
    private readonly host: SessionTitleEngineHost,
    private readonly buildRequest: SessionTitleRequestBuilder<T, R>,
  ) {}

  /**
   * Accept an explicit user title. It pins the title: in-flight automatic
   * generation is superseded and later user messages schedule none (an
   * explicit {@link SessionTitleEngine.refresh} remains the deliberate unpin).
   * @param target - exact live Session.
   * @param title - raw user input; normalized before acceptance.
   * @returns the accepted title snapshot.
   * @throws {SessionTitleInvalidError} when the title normalizes to empty.
   * @throws {Error} when the session is not live or the service is disposed.
   */
  rename(target: T, title: string): SessionTitleSnapshot {
    this.assertServiceActive()
    this.assertLive(target)
    const normalized = normalizeSessionTitle(title, this.config.maxTitleBytes)
    if (normalized.length === 0) {
      throw new SessionTitleInvalidError('session title must contain visible characters')
    }
    const state = this.stateFor(target)
    this.supersede(state, 'user rename superseded automatic title generation')
    target.commit({ title: normalized, messageSeqs: [], source: { kind: 'user' } })
    const snapshot = target.title()
    /* v8 ignore next -- unreachable: the commit above just folded a session/title event. */
    if (snapshot === undefined) throw new Error('renamed title failed to fold')
    return snapshot
  }

  /**
   * Explicitly retry the registered provider, or materialize the built-in
   * fallback when no provider is registered.
   * @param target - exact live Session.
   * @param signal - optional caller cancellation.
   * @returns latest accepted title, or `undefined` when no eligible text exists.
   */
  async refresh(target: T, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined> {
    signal?.throwIfAborted()
    this.assertServiceActive()
    this.assertLive(target)
    const registration = this.registration
    const input = target.input()
    if (registration === undefined || registration.closing || input.lastSeq === null) {
      // Explicit refresh is the unpin even without a provider: a standing
      // user title must not short-circuit ensureFallback into a no-op, so
      // re-derive and append the fallback over it when one is derivable.
      const current = target.title()
      const first = input.first
      if (current?.source.kind === 'user' && first !== null) {
        this.appendFallback(target, first)
        await target.persist?.()
        signal?.throwIfAborted()
        return target.title()
      }
      const fallback = await this.ensureFallback(target)
      signal?.throwIfAborted()
      return fallback
    }
    const state = this.stateFor(target)
    const revision = this.supersede(state, 'explicit title refresh superseded older generation')
    const work = this.activate({ registration, revision, throughSeq: input.lastSeq }, state, signal)
    const config = target.session.requestHeader()?.config
    const route = config === undefined ? undefined : { provider: config.provider, model: config.model }
    return this.startProvider(target, work, route, state)
  }

  /**
   * Reject a malformed or duplicate provider before the runtime publishes a registration.
   * @param provider - candidate provider.
   * @returns nothing; narrows `provider` when it does not throw.
   */
  assertRegistrable(provider: unknown): asserts provider is SessionTitleEngineProvider<R> {
    if (provider === null || typeof provider !== 'object') {
      throw new Error('session-title provider must be an object')
    }
    const candidate = provider as Record<string, unknown>
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      throw new Error('session-title provider id must be a non-empty string')
    }
    if (candidate.automatic !== 'first-prompt' && candidate.automatic !== 'all-prompts') {
      throw new Error('session-title provider automatic mode is invalid')
    }
    if (typeof candidate.generate !== 'function') {
      throw new Error(`session-title provider "${candidate.id}" requires generate()`)
    }
    if (this.registration !== undefined) {
      throw new Error(`session-title provider "${this.registration.provider.id}" is already registered`)
    }
  }

  /**
   * Install the sole optional provider.
   * @param provider - provider identity, cadence, and generation function.
   * @returns removal that aborts the provider's pending and active work and settles after it quiesces.
   */
  register(provider: SessionTitleEngineProvider<R>): () => Promise<void> {
    this.assertRegistrable(provider)
    const registration: ProviderRegistration<R> = { provider, active: new Set(), closing: false }
    this.registration = registration
    return async () => {
      registration.closing = true
      for (const state of this.work.values()) {
        if (state.pending?.registration === registration) delete state.pending
        if (state.active?.registration === registration) {
          state.active.controller.abort(new Error(`session-title provider "${provider.id}" was disposed`))
        }
      }
      await this.drain(registration.active)
      if (this.registration === registration) this.registration = undefined
    }
  }

  /**
   * Schedule fallback creation and any provider cadence for one appended user message.
   * The target's folds must already include the event.
   * @param target - Session target.
   * @param event - appended `user/message` event.
   */
  onUserMessage(target: T, event: Extract<SessionEvent, { type: 'user/message' }>): void {
    if (!this.host.active() || !target.live()) return
    if (event.data.source.kind !== 'user' || sessionTitleUserMessageOf(event) === undefined) return
    // A user rename pins the title: no automatic revision may override it.
    if (target.title()?.source.kind === 'user') return
    const state = this.stateFor(target)
    if (state.closing) return
    const registration = this.registration
    if (registration !== undefined && !registration.closing) {
      const count = target.input().count
      const shouldSchedule = registration.provider.automatic === 'all-prompts'
        || (target.session.header.parentSession === undefined && count === 1 && target.title() === undefined)
      if (shouldSchedule) {
        const revision = this.supersede(state, 'newer user message superseded title generation')
        state.pending = { registration, revision, throughSeq: event.seq }
      }
    }
    this.defer(async () => {
      try {
        await this.ensureFallback(target)
      } catch (error: unknown) {
        if (!this.host.active()) return
        this.host.warn(`session "${target.session.id}": fallback title update failed: ${String(error)}`)
      }
    }, state)
  }

  /**
   * Start pending automatic work once a main request after its input is known to use a route.
   * @param target - Session target.
   * @param seq - seq of the logged header or step boundary that proves the request follows the input.
   * @param route - exact route of that request.
   */
  onMainRequest(target: T, seq: SessionSeq, route: SessionTitleModelProvenance | undefined): void {
    if (!this.host.active()) return
    const state = this.work.get(target)
    const pending = state?.pending
    if (state === undefined || state.closing || pending === undefined || pending.throughSeq >= seq) return
    this.startPending(target, state, pending, route)
  }

  /**
   * Abort and forget one released Session's work.
   * @param target - released target.
   * @param reason - abort reason.
   * @returns after all work accepted for this target settles.
   */
  async forget(target: T, reason: string): Promise<void> {
    const state = this.retire(target, reason)
    if (state !== undefined) await this.drain(state.operations)
  }

  /** Wait for title work already admitted for one live target without changing its revision.
   * @param target - live title target.
   * @returns completion after accepted work for that target settles.
   */
  async settle(target: T): Promise<void> {
    const state = this.work.get(target)
    if (state !== undefined) await this.drain(state.operations)
  }

  /**
   * Stop accepting work for one Session without waiting for its provider.
   * Remaining work stays in the engine's lifetime registry and `dispose()` drains it.
   * @param target - released target.
   * @param reason - abort reason.
   */
  abandon(target: T, reason: string): void {
    this.retire(target, reason)
  }

  /** Close one target and return its outstanding work to the current lifecycle owner. */
  private retire(target: T, reason: string): SessionTitleWorkState<R> | undefined {
    const state = this.work.get(target)
    if (state === undefined) return undefined
    state.closing = true
    delete state.pending
    state.active?.controller.abort(new Error(reason))
    this.work.delete(target)
    return state
  }

  /** Abort all work and wait for every accepted background operation. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('session-title service disposed'))
    if (this.registration !== undefined) this.registration.closing = true
    this.registration = undefined
    for (const state of this.work.values()) {
      state.closing = true
      delete state.pending
      state.active?.controller.abort(new Error('session-title service disposed'))
    }
    await this.drain(this.inFlight)
    this.work.clear()
  }

  /** Whether the engine itself has been disposed. */
  get disposed(): boolean { return this.lifetime.signal.aborted }

  /** Consume one pending revision and schedule its non-blocking provider call. */
  private startPending(
    target: T,
    state: SessionTitleWorkState<R>,
    pending: PendingAutomaticWork<R>,
    route: SessionTitleModelProvenance | undefined,
  ): void {
    delete state.pending
    let release: (() => void) | undefined
    if (target.hold !== undefined) {
      try { release = target.hold() } catch { return }
    }
    this.defer(async () => {
      try {
        if (state.closing
          || this.registration !== pending.registration
          || pending.registration.closing
          || this.work.get(target) !== state
          || state.revision !== pending.revision) return
        const work = this.activate(pending, state)
        try {
          await this.startProvider(target, work, route, state)
        } catch (error: unknown) {
          if (work.signal.aborted || !this.host.active()) return
          this.host.warn(`session "${target.session.id}": automatic title generation failed: ${String(error)}`)
        }
      } finally { release?.() }
    }, state)
  }

  /** Start one tracked provider call after publishing its active revision. */
  private startProvider(
    target: T,
    work: ActiveProviderWork<R>,
    route?: SessionTitleModelProvenance,
    state?: SessionTitleWorkState<R>,
  ): Promise<SessionTitleSnapshot | undefined> {
    if (state?.closing) return Promise.reject(new Error('session-title: target is closing'))
    const run = Promise.resolve().then(() => this.runProvider(target, work, route))
    return this.track(run, work.registration, state)
  }

  /** Execute and accept one current provider revision. */
  private async runProvider(
    target: T,
    work: ActiveProviderWork<R>,
    route?: SessionTitleModelProvenance,
  ): Promise<SessionTitleSnapshot | undefined> {
    try {
      this.assertCurrent(target, work)
      await this.ensureFallback(target)
      this.assertCurrent(target, work)
      const read = target.messages(work.throughSeq, work.signal)
      const messages = read instanceof Promise ? await read : read
      this.assertCurrent(target, work)
      const result = await work.registration.provider.generate(this.buildRequest({
        session: target.session,
        messages,
        ...route === undefined ? {} : { route },
        signal: work.signal,
      }, target, () => { this.assertCurrent(target, work) }))
      this.assertCurrent(target, work)
      const accepted = validateSessionTitleResult(result, messages, this.config.maxTitleBytes)
      target.commit({
        title: accepted.title,
        messageSeqs: [...accepted.messageSeqs],
        source: {
          kind: 'provider',
          provider: work.registration.provider.id,
          ...accepted.model === undefined ? {} : { model: accepted.model },
        },
      })
      await target.persist?.()
      return target.title()
    } finally {
      const state = this.work.get(target)
      if (state?.active === work) delete state.active
    }
  }

  /** Fail a completion whose provider, revision, session, or signal is stale. */
  private assertCurrent(target: T, work: ActiveProviderWork<R>): void {
    this.assertServiceActive()
    work.signal.throwIfAborted()
    const state = this.work.get(target)
    /* v8 ignore next -- every supported supersession, provider disposal, and session disposal aborts
     * the work signal before changing this state. */
    if (this.registration !== work.registration
      || state?.closing
      || state?.active !== work
      || state.revision !== work.revision
      || !target.live()) {
      throw new Error('session title generation state changed without cancellation')
    }
  }

  /** Create and publish an active provider call from one fixed revision. */
  private activate(
    pending: PendingAutomaticWork<R>,
    state: SessionTitleWorkState<R>,
    upstream?: AbortSignal,
  ): ActiveProviderWork<R> {
    const controller = new AbortController()
    const signal = upstream === undefined
      ? AbortSignal.any([controller.signal, this.lifetime.signal])
      : AbortSignal.any([controller.signal, this.lifetime.signal, upstream])
    const work: ActiveProviderWork<R> = { ...pending, controller, signal }
    state.active = work
    return work
  }

  /** Abort older active work and reserve the next session-local revision. */
  private supersede(state: SessionTitleWorkState<R>, reason: string): number {
    state.active?.controller.abort(new Error(reason))
    delete state.pending
    state.revision += 1
    return state.revision
  }

  /** Return mutable work state for one session. */
  private stateFor(target: T): SessionTitleWorkState<R> {
    let state = this.work.get(target)
    if (state === undefined) {
      state = { revision: 0, operations: new Set() }
      this.work.set(target, state)
    }
    return state
  }

  /** Queue detached service work and retain it through service disposal. */
  private defer(task: () => Promise<void>, state?: SessionTitleWorkState<R>): void {
    const run = Promise.resolve().then(async () => {
      if (!this.host.active()) return
      await task()
    })
    void this.track(run, undefined, state)
  }

  /** Retain one promise until settlement for service and optional provider teardown. */
  private track<V>(run: Promise<V>, registration?: ProviderRegistration<R>, state?: SessionTitleWorkState<R>): Promise<V> {
    this.inFlight.add(run)
    registration?.active.add(run)
    state?.operations.add(run)
    const settled = (): void => {
      this.inFlight.delete(run)
      registration?.active.delete(run)
      state?.operations.delete(run)
    }
    void run.then(settled, settled)
    return run
  }

  /** Await every current and settling promise in one lifecycle registry. */
  private async drain(active: Set<Promise<unknown>>): Promise<void> {
    while (active.size > 0) await Promise.allSettled([...active])
  }

  /** Reject work once the owning service has begun unloading. */
  private assertServiceActive(): void {
    if (!this.host.active()) throw new Error('session-title service disposed')
  }

  /** Reject a target that can no longer write. */
  private assertLive(target: T): void {
    if (!target.live()) throw new Error(`session "${target.session.id}" is not live in this store`)
  }

  /**
   * Derive and append the deterministic fallback title over whatever stands
   * (the refresh unpin path: overwriting a pinned user title is the point).
   * Synchronous on purpose — no await may separate derivation from append.
   * An underivable fallback (empty after the caps) appends nothing.
   */
  private appendFallback(target: T, first: SessionTitleUserMessage): void {
    const title = fallbackSessionTitle(first.text, this.config.fallbackMaxWords, this.config.fallbackMaxBytes)
    if (title.length === 0) return
    target.commit({ title, messageSeqs: [first.seq], source: { kind: 'fallback' } })
  }

  /** Create the first deterministic fallback if the session still lacks a title. */
  private async ensureFallback(target: T): Promise<SessionTitleSnapshot | undefined> {
    this.assertServiceActive()
    this.assertLive(target)
    const state = this.stateFor(target)
    if (state.closing) throw new Error('session-title: target is closing')
    const current = target.title()
    if (current !== undefined) return current
    const first = target.input().first
    if (first === null) return undefined
    const title = fallbackSessionTitle(first.text, this.config.fallbackMaxWords, this.config.fallbackMaxBytes)
    if (title.length === 0) return undefined
    if (state.fallback !== undefined) return state.fallback
    const fallback = Promise.resolve().then(async () => {
      this.assertServiceActive()
      this.assertLive(target)
      const accepted = target.title()
      if (accepted !== undefined) return accepted
      target.commit({ title, messageSeqs: [first.seq], source: { kind: 'fallback' } })
      await target.persist?.()
      return target.title()
    })
    state.fallback = this.track(fallback, undefined, state)
    try {
      return await fallback
    } finally {
      delete state.fallback
    }
  }
}
