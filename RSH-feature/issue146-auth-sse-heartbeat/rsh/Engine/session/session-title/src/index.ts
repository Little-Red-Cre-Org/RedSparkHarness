/**
 * Log-backed session title service, deterministic fallback, and provider contract.
 * @module @deepseek-ai/dsh-session-title
 */

import { Context, FiberState, Service, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {
  Session,
  SessionEvent,
} from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-agent'
export type {
  SessionTitleEventData,
  SessionTitleModelProvenance,
  SessionTitleSnapshot,
  SessionTitleSource,
  SessionTitleUserMessage,
  TitleProjection,
} from './types.ts'
import type {
  SessionTitleSnapshot,
  SessionTitleUserMessage,
  TitleInputState,
} from './types.ts'
import {
  collectSessionTitleMessages,
  EMPTY_TITLE_INPUT,
  foldSessionTitle,
  foldTitleInput,
  resolveSessionTitleConfig,
  type SessionTitleConfig,
} from './facts.ts'
import {
  SessionTitleEngine,
  type SessionTitleEngineProvider,
  type SessionTitleTarget,
} from './engine.ts'
export {
  foldSessionTitle,
  SessionTitleProviderId,
} from './facts.ts'
export type { SessionTitleAutomaticMode, SessionTitleProviderResult } from './facts.ts'
export { SessionTitleInvalidError } from './engine.ts'
export type { SessionTitleProviderRequest } from './engine.ts'

export { fallbackSessionTitle, normalizeSessionTitle, truncateTitleUtf8 } from './normalize.ts'

/** Required deterministic fallback and accepted-title limits. */
export interface Config extends SessionTitleConfig {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTitle: SessionTitleService
  }
}

/** One optional asynchronous title implementation registered with the service. */
export interface SessionTitleProvider extends SessionTitleEngineProvider {}

const sessionTitleUserMessageSchema: ZodType<SessionTitleUserMessage> = zod.object({
  seq: zod.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq),
  text: zod.string(),
}).strict()

const titleInputStateSchema: ZodType<TitleInputState> = zod.object({
  first: sessionTitleUserMessageSchema.nullable(),
  count: zod.number().int().nonnegative(),
  lastSeq: zod.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq).nullable(),
}).strict().superRefine((state, context) => {
  const empty = state.first === null && state.lastSeq === null && state.count === 0
  const populated = state.first !== null
    && state.lastSeq !== null
    && state.count > 0
    && state.first.seq <= state.lastSeq
  if (!empty && !populated) {
    context.addIssue({
      code: 'custom',
      message: 'title input state must pair its count with first and last message seqs',
    })
  }
})

const titleViewSchema: ZodType<string | null> = zod.string().min(1).nullable()

/** Latest logged title text and its client view. */
export const titleProjectionDefinition = {
  key: 'title',
  stateVersion: 1,
  stateSchema: titleViewSchema,
  init: () => null,
  apply: (state, event) => (event.type === 'session/title'
    ? event.data.title
    : state),
  wire: {
    viewSchema: titleViewSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'title', string | null>

/**
 * Log-backed title fold plus asynchronous fallback generation. The title
 * behavior is the shared framework-free {@link SessionTitleEngine}; this
 * service is the Cordis glue: projections, event wiring, and lifetime.
 */
export class SessionTitleService extends Service {
  static inject = ['sessions', 'sessionProjections']
  static Config: z<Config> = z.object({
    fallbackMaxWords: z.number().step(1).min(1).required(),
    fallbackMaxBytes: z.number().step(1).min(1).required(),
    maxTitleBytes: z.number().step(1).min(1).required(),
  })

  private readonly ownerFiber: Fiber
  private readonly engine: SessionTitleEngine<SessionTitleTarget>
  private readonly targets = new Map<Session, SessionTitleTarget>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionTitle')
    this.ownerFiber = ctx.fiber
    this.engine = new SessionTitleEngine(resolveSessionTitleConfig(config), {
      active: () => this.serviceActive(),
      warn: (message) => { this.ctx.logger.warn(message) },
    }, base => base)

    ctx.effect(() => async () => {
      await this.engine.dispose()
      this.targets.clear()
    }, 'sessionTitle lifecycle')

    ctx.sessionProjections.register(titleProjectionDefinition)

    ctx.sessionProjections.register<'titleInput', TitleInputState>({
      key: 'titleInput',
      stateVersion: 3,
      stateSchema: titleInputStateSchema,
      init: () => EMPTY_TITLE_INPUT,
      apply: foldTitleInput,
    })

    ctx.on('session/event', (session, event) => {
      switch (event.type) {
        case 'user/message':
          this.engine.onUserMessage(this.target(session), event)
          break
        case 'request/header':
          this.onRequestHeader(session, event)
          break
        default:
          break
      }
    })
    ctx.on('llm/stream', (options, next) => {
      this.onMainRequest(options)
      return next()
    }, { global: true, prepend: true })
    ctx.on('session/disposed', (session) => {
      const target = this.targets.get(session)
      if (target === undefined) return
      this.targets.delete(session)
      this.engine.abandon(target, 'session disposed during title generation')
    })
  }

  /**
   * Read the latest folded title from one live or replayed session.
   * @param session - session whose log is the title source of truth.
   * @returns latest title snapshot, or `undefined` before eligible input.
   */
  get(session: Session): SessionTitleSnapshot | undefined {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    return foldSessionTitle(session.snapshotEvents())
  }

  /**
   * Accept an explicit user title. Appends a `session/title` event with the
   * `user` source, which pins the title: in-flight automatic generation is
   * superseded and later user messages schedule none (an explicit
   * {@link SessionTitleService.refresh} remains the deliberate unpin).
   * @param session - exact live session to rename.
   * @param title - raw user input; normalized before acceptance.
   * @returns the accepted title snapshot.
   * @throws {SessionTitleInvalidError} when the title normalizes to empty.
   * @throws {Error} when the session is not live or the service is disposed.
   */
  rename(session: Session, title: string): SessionTitleSnapshot {
    return this.engine.rename(this.target(session), title)
  }

  /**
   * Explicitly retry the registered provider, or materialize the built-in
   * fallback when no provider is registered.
   * @param session - exact live session to refresh.
   * @param signal - optional caller cancellation.
   * @returns latest accepted title, or `undefined` when no eligible text exists.
   */
  async refresh(session: Session, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined> {
    return await this.engine.refresh(this.target(session), signal)
  }

  /**
   * Register the sole optional title provider. Disposal aborts its pending and
   * active work before another provider may register.
   * @param provider - provider identity, cadence, and generation function.
   * @returns exact Cordis effect disposer, which settles after active calls quiesce.
   */
  register(provider: SessionTitleProvider): () => Promise<void> {
    this.engine.assertRegistrable(provider)
    return this.ctx.effect(function* (this: SessionTitleService) {
      yield this.engine.register(provider)
    }.bind(this), 'sessionTitle.register()')
  }

  /** Start pending automatic work only after its exact main-request route is logged. */
  private onRequestHeader(session: Session, event: Extract<SessionEvent, { type: 'request/header' }>): void {
    const target = this.targets.get(session)
    if (target === undefined) return
    this.engine.onMainRequest(target, event.seq, {
      provider: event.data.header.config.provider,
      model: event.data.header.config.model,
    })
  }

  /** Start unchanged-route work from the marked loop request after its header fold is current. */
  private onMainRequest(options: GenerateOptions): void {
    if (!this.serviceActive() || options.sessionId === undefined || !isAgentLoopRequest(options)) return
    const session = this.ctx.sessions.get(options.sessionId)
    const target = session === undefined ? undefined : this.targets.get(session)
    if (session === undefined || target === undefined) return
    const boundary = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.lastStepBoundary
    const route = session.requestHeader()?.config
    if (boundary?.kind !== 'start'
      || route?.provider !== options.provider
      || route.model !== options.model) return
    this.engine.onMainRequest(target, boundary.seq, { provider: options.provider, model: options.model })
  }

  /** Return the engine target of one session: its projections, snapshot reads, and append. */
  private target(session: Session): SessionTitleTarget {
    let target = this.targets.get(session)
    if (target === undefined) {
      target = {
        session,
        title: () => this.get(session),
        input: () => this.ctx.sessionProjections.stateOf(session, 'titleInput') as TitleInputState,
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        messages: throughSeq => collectSessionTitleMessages(session.snapshotEvents(), throughSeq),
        live: () => this.ctx.sessions.get(session.id) === session,
        commit: (data) => { session.append('session/title', data) },
      }
      this.targets.set(session, target)
    }
    return target
  }

  /** Whether the owning plugin fiber can still start or commit title work. */
  private serviceActive(): boolean {
    return !this.engine.disposed
      && this.ownerFiber.uid !== null
      && this.ownerFiber.state === FiberState.ACTIVE
  }
}

export default SessionTitleService
