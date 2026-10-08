/**
 * Native session titles over the selected Program's sole Session writer: the
 * deterministic fallback after the first eligible human message, one optional
 * provider started once the main request route is logged, and explicit user
 * renames. The durable `session/title` event and the provider contract are
 * shared with the Cordis service.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-10-08-native-session-title-and-plan-mode.md
 *
 * @module @deepseek-ai/dsh-session-title/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session/native'
import {
  SessionTitleEngine,
  type SessionTitleEngineProvider,
  type SessionTitleProviderRequest,
  type SessionTitleTarget,
} from './engine.ts'
import {
  collectSessionTitleMessages,
  resolveSessionTitleConfig,
  sessionTitleUserMessageOf,
  titleSnapshotFromState,
  type SessionTitleConfig,
} from './facts.ts'
import type { SessionTitleSnapshot, TitleInputState } from './types.ts'

export {
  collectSessionTitleMessages,
  foldSessionTitle,
  resolveSessionTitleConfig,
  SessionTitleProviderId,
  validateSessionTitleResult,
} from './facts.ts'
export type { SessionTitleAutomaticMode, SessionTitleConfig, SessionTitleProviderResult } from './facts.ts'
export { SessionTitleEngine, SessionTitleInvalidError } from './engine.ts'
export type { SessionTitleEngineProvider, SessionTitleProviderRequest, SessionTitleTarget } from './engine.ts'
export { fallbackSessionTitle, normalizeSessionTitle, truncateTitleUtf8 } from './normalize.ts'
export type {
  SessionTitleEventData,
  SessionTitleModelProvenance,
  SessionTitleSnapshot,
  SessionTitleSource,
  SessionTitleUserMessage,
} from './types.ts'

/** Input supplied to one native title-provider call: the shared request plus log-only append authority. */
export interface NativeSessionTitleRequest extends SessionTitleProviderRequest {
  /**
   * Append and persist one provider-owned log-only event through the Session's sole writer.
   * @param type - declared non-surface event type.
   * @param data - event payload.
   */
  readonly appendEvent: <T extends SessionEventType>(type: T, data: SessionEventMap[T]) => Promise<void>
}

/** One optional asynchronous native title implementation. */
export interface NativeSessionTitleProvider extends SessionTitleEngineProvider<NativeSessionTitleRequest> {}

/** Native session-title capability. */
export interface NativeSessionTitles {
  /**
   * Read the latest logged title of an attached Agent's Session.
   * @param agent - exact live Agent.
   * @returns the title snapshot, or undefined before any title or when detached.
   */
  get(agent: NativeAgent): SessionTitleSnapshot | undefined
  /**
   * Accept an explicit user title; it pins the title against automatic revisions.
   * @param owner - the Session's sole writer.
   * @param title - raw user input, normalized before acceptance.
   * @returns the accepted snapshot.
   */
  rename(owner: NativeActiveSessionOwner, title: string): Promise<SessionTitleSnapshot>
  /**
   * Explicitly retry the registered provider, or materialize the fallback; also the unpin of a user title.
   * @param owner - the Session's sole writer.
   * @param signal - optional caller cancellation.
   * @returns the latest accepted title, or undefined when no eligible text exists.
   */
  refresh(owner: NativeActiveSessionOwner, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>
  /**
   * Register the sole optional provider.
   * @param provider - provider identity, cadence, and generation function.
   * @returns removal that aborts and drains the provider's work.
   */
  register(provider: NativeSessionTitleProvider): () => Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Durable Session titles, deterministic fallback, and the optional provider seam. */
    sessionTitles: NativeSessionTitles
  }
}

/** Engine target of one attached owner: folded title facts over the owner's log and sole writer. */
interface OwnerTarget extends SessionTitleTarget {
  readonly owner: NativeActiveSessionOwner
  snapshot: SessionTitleSnapshot | undefined
  facts: TitleInputState
  detached: boolean
  stop: () => void
}

/** Native glue: owner attachment, event forwarding, and persistence around the shared engine. */
class NativeSessionTitleService implements NativeSessionTitles {
  private readonly targets = new Map<NativeAgent, OwnerTarget>()
  private readonly engine: SessionTitleEngine<OwnerTarget, NativeSessionTitleRequest>

  /**
   * @param config - validated fallback and acceptance limits.
   * @param warn - diagnostic sink for non-fatal background failures.
   */
  constructor(config: SessionTitleConfig, warn: (message: string) => void) {
    this.engine = new SessionTitleEngine<OwnerTarget, NativeSessionTitleRequest>(config, {
      active: () => !this.engine.disposed,
      warn,
    }, (base, target, guard) => ({
      ...base,
      appendEvent: async (type, data) => {
        guard()
        ;(target.owner.append as (type: SessionEventType, data: unknown) => SessionEvent)(type, data)
        await target.owner.flush()
      },
    }))
  }

  /** @inheritdoc */
  get(agent: NativeAgent): SessionTitleSnapshot | undefined { return this.targets.get(agent)?.snapshot }

  /** @inheritdoc */
  async rename(owner: NativeActiveSessionOwner, title: string): Promise<SessionTitleSnapshot> {
    const snapshot = this.engine.rename(this.targetOf(owner), title)
    await owner.flush()
    return snapshot
  }

  /** @inheritdoc */
  refresh(owner: NativeActiveSessionOwner, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined> {
    return this.engine.refresh(this.targetOf(owner), signal)
  }

  /** @inheritdoc */
  register(provider: NativeSessionTitleProvider): () => Promise<void> {
    if (this.engine.disposed) throw new Error('session-title service disposed')
    return this.engine.register(provider)
  }

  /**
   * Fold one newly attached owner and forward its later durable events.
   * @param owner - exact Session writer.
   */
  async attach(owner: NativeActiveSessionOwner): Promise<void> {
    if (this.engine.disposed) throw new Error('session-title service disposed')
    const target: OwnerTarget = {
      owner,
      session: owner.session,
      snapshot: undefined,
      facts: { first: null, count: 0, lastSeq: null },
      detached: false,
      stop: () => {},
      title: () => target.snapshot,
      input: () => target.facts,
      messages: async (throughSeq, signal) => collectSessionTitleMessages(await owner.readEvents({ signal }), throughSeq),
      live: () => !target.detached && owner.writerAvailable,
      commit: (data) => { fold(target, owner.append('session/title', data)) },
      persist: () => owner.flush(),
      hold: () => owner.retain(),
    }
    const buffered: SessionEvent[] = []
    let ready = false
    target.stop = owner.onEvent((event) => {
      if (ready) this.observe(target, event)
      else buffered.push(event)
    })
    try {
      const events = await owner.readEvents()
      for (const event of events) fold(target, event)
      const watermark = events.at(-1)?.seq
      ready = true
      this.targets.set(owner.agent, target)
      for (const event of buffered) if (watermark === undefined || event.seq > watermark) this.observe(target, event)
    } catch (failure: unknown) { target.stop(); throw failure }
  }

  /**
   * Abort and forget one released owner's work.
   * @param owner - exact released Session writer.
   */
  detach(owner: NativeActiveSessionOwner): void {
    const target = this.targets.get(owner.agent)
    if (target?.owner !== owner) return
    this.targets.delete(owner.agent)
    target.detached = true
    this.engine.forget(target, 'session detached during title generation')
    target.stop()
  }

  /** Abort all work and wait for accepted background operations. */
  async dispose(): Promise<void> {
    for (const target of this.targets.values()) target.stop()
    await this.engine.dispose()
    this.targets.clear()
  }

  /** Fold one live event and forward the engine's triggers. */
  private observe(target: OwnerTarget, event: SessionEvent): void {
    // The engine's own commits fold on append; a replayed copy refolds identically.
    fold(target, event)
    if (event.type === 'user/message') {
      this.engine.onUserMessage(target, event)
    } else if (event.type === 'request/header') {
      this.engine.onMainRequest(target, event.seq, { provider: event.data.header.config.provider, model: event.data.header.config.model })
    } else if (event.type === 'step/end') {
      // An unchanged route logs no new header; the finished step's request used the current one.
      const config = target.owner.session.requestHeader()?.config
      this.engine.onMainRequest(target, event.seq, config === undefined ? undefined : { provider: config.provider, model: config.model })
    }
  }

  private targetOf(owner: NativeActiveSessionOwner): OwnerTarget {
    const target = this.targets.get(owner.agent)
    if (target?.owner !== owner) throw new Error('session-title: Session owner is not attached')
    return target
  }
}

/**
 * Apply one durable event to an owner's folded title facts.
 * @param target - mutable folded state.
 * @param event - durable event.
 */
function fold(target: OwnerTarget, event: SessionEvent): void {
  if (event.type === 'session/title') {
    if (target.snapshot?.eventSeq === event.seq) return
    target.snapshot = titleSnapshotFromState({
      title: event.data.title, messageSeqs: event.data.messageSeqs, source: event.data.source,
      eventSeq: event.seq, updatedAt: event.time,
    })
    return
  }
  const message = sessionTitleUserMessageOf(event)
  if (message === undefined || (target.facts.lastSeq !== null && message.seq <= target.facts.lastSeq)) return
  target.facts = { first: target.facts.first ?? message, count: target.facts.count + 1, lastSeq: message.seq }
}

/** Native session-title Provider over the selected active Session registry. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-title',
  targets: ['host'],
  requires: ['activeSessions'],
  provides: ['sessionTitles'],
  resolve(input) {
    const config = resolveSessionTitleConfig(input)
    return async (context) => {
      const sessions = context.require('activeSessions')
      const service = new NativeSessionTitleService(config, (message) => { console.warn(message) })
      context.own(() => service.dispose())
      context.effect(sessions.onAttached(owner => service.attach(owner)))
      context.effect(sessions.onDetached((owner) => {
        service.detach(owner)
        return Promise.resolve()
      }))
      for (const owner of sessions.owners()) await service.attach(owner)
      context.provide('sessionTitles', service)
    }
  },
}
