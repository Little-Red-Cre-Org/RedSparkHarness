/** Program continuation factory retaining the selected Agent execution and Session writer. */
import { NativeScope, ResourceOwner } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentExecution, type NativeAgentRegistry, type InboxTarget } from '@deepseek-ai/dsh-native-agent'
import { SESSION_FORMAT_VERSION, SessionId, type Session, type SessionHeader } from '@deepseek-ai/dsh-session/native'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeSessionConfiguration, NativeSessionTurnResult } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeContinuationRequest, NativeSessionContinuation, NativeSessionContinuations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeContinuationObservation } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeContinuationCandidate, NativeContinuationInspection } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { SessionPersistenceCorruptionError, SessionFormatUnsupportedError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence/native'
import { foldNativeAgentPresetFacts } from '@deepseek-ai/dsh-agent-presets/selection'
import { NativeContinuationSession } from './continuation-session.ts'
import { NativeContinuationActivation } from './continuation-activation.ts'

/** Program callbacks retain its existing Agent map, ordinary turn driver and parent inbox ownership. */
export interface NativeContinuationProgram {
  readonly storage: NativeSessionPersistenceOperations
  readonly agents: NativeAgentRegistry
  /** Resolve immutable routing from the exact live parent, including Workspace selection.
   * @param agent - registered parent Agent owned by this Program.
   * @returns the same configuration selected before its creation.
   */
  configuration(agent: NativeAgent): Readonly<NativeSessionConfiguration>
  readonly lifetime: AbortSignal
  /**
   * Read through another selected live owner, such as an ordinary one-shot child.
   * @param id - Session identity.
   * @param signal - read cancellation.
   * @returns live observation, or undefined for cold storage.
   */
  observe?(id: SessionId, signal: AbortSignal): Promise<NativeContinuationObservation | undefined>
  /** Drain active-owner Consumers before the selected writer closes. @param owner - sole child writer. @returns quiescent release. */
  closing?(owner: NativeContinuationSession): Promise<void>
  /**
   * Obtain one fresh native Agent execution registration in the Program's existing map.
   * @param id - child Session id.
   * @param scope - child visibility scope.
   * @param parent - exact live parent owned by the selected Program.
   * @returns exact execution and quiescent Agent/map release.
   */
  acquire(id: SessionId, scope: NativeScope, parent: NativeAgent): Promise<{
    readonly execution: NativeAgentExecution
    readonly preset: string | null
    release(): Promise<void>
  }>
  /**
   * Invoke the ordinary Program turn driver with this resident writer.
   * @param request - resolved child configuration and composition.
   * @param owner - sole Session and writer owner.
   * @param agent - exact registered child.
   * @param initial - first turn of a fresh child.
   * @param ready - initial facts have reached the selected writer's checkpoint.
   * @param signal - current-turn cancellation.
   * @returns the existing driver's terminal result.
   */
  run(request: NativeContinuationRequest, owner: NativeContinuationSession, agent: NativeAgent,
    initial: boolean, ready: () => void, signal: AbortSignal): Promise<NativeSessionTurnResult>
  /** Maintain a materialized child using the same Program driver setup and exact delegated owner.
   * @param request - immutable child composition selected during materialization.
   * @param owner - sole retained child writer.
   * @param agent - exact registered child.
   * @param operation - human operation without synthetic model input.
   * @param signal - composed admission cancellation.
   * @returns callback result after its durable checkpoint.
   */
  maintenance<T>(request: NativeContinuationRequest, owner: NativeContinuationSession, agent: NativeAgent,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
  /**
   * Admit input to a target outside this runtime's resident child map.
   * @param sender - exact initiating Agent or notification owner.
   * @param session - sender's Session identity and lineage.
   * @param id - adjacent live recipient.
   * @param message - attributed input to persist.
   * @param target - pending destination.
   * @param wake - whether idle input should wake the selected driver.
   * @param signal - admission-only cancellation.
   * @returns accepted durable input id.
   */
  deliver(sender: NativeAgent, session: Session, id: SessionId, message: UserMessage,
    target: InboxTarget, wake: boolean, signal: AbortSignal): Promise<MessageId>
}

interface Resident {
  readonly request: NativeContinuationRequest
  readonly parent: NativeAgent
  readonly owner: NativeContinuationSession
  readonly activation: NativeContinuationActivation
  readonly handle: NativeSessionContinuation
}

/** One Program-owned residency map; modules contribute composition and never own a second writer or inbox. */
export class NativeContinuationRuntime {
  private readonly resident = new Map<SessionId, Resident>()
  private closing: Promise<void> | undefined
  private readonly starts = new Set<Promise<NativeSessionContinuation>>()
  private readonly startingIds = new Set<SessionId>()
  private readonly shutdown = new AbortController()
  private readonly startupCleanupFailures: unknown[] = []

  /** @param program - selected Program's existing registration, driver, storage and admission callbacks. */
  constructor(private readonly program: NativeContinuationProgram) {}

  /**
   * Bind continuation operations to an exact live parent or adjacent-message sender.
   * @param agent - exact registered identity selected by the active Session owner.
   * @param session - exact Session selected by the execution routing Provider.
   * @returns operations retaining that identity without exposing Program application classes.
   */
  forParent(agent: NativeAgent, session: Session): NativeSessionContinuations {
    return {
      open: (request, signal) => this.open(agent, session, request, signal),
      maintenance: async (id, operation, signal) => {
        this.assertParent(agent)
        const child = this.resident.get(id)
        if (child === undefined || child.parent !== agent || child.owner.session.header.parentSession !== session.id
          || child.owner.session.header.origin !== 'subagent' || child.handle.isClosing) {
          throw new Error('native-continuation: maintenance requires this exact parent resident child')
        }
        const release = child.activation.retainChild()
        try {
          return await this.program.maintenance(child.request, child.owner, child.handle.agent, operation,
            AbortSignal.any([signal, this.shutdown.signal, this.program.lifetime]))
        } finally { release() }
      },
      catalog: (scope, signal) => this.catalog(agent, session, scope, signal),
      inspect: async (path, signal) => {
        this.assertParent(agent)
        const visited = new Set<SessionId>([session.id])
        let parent = session.id
        let parentDepth = session.header.delegationDepth ?? 0
        let observation: NativeContinuationObservation | undefined
        for (const id of path) {
          signal.throwIfAborted()
          if (visited.has(id)) return { kind: 'diagnostic', id: path.at(-1) ?? id, reason: 'corrupt' }
          visited.add(id)
          const inspected = await this.inspect(id, signal, this.program.configuration(agent))
          if (inspected.kind === 'diagnostic') {
            return { kind: 'diagnostic', id: path.at(-1) ?? id, reason: inspected.reason }
          }
          observation = inspected.observation
          if (observation.header.parentSession !== parent
            || observation.header.cwd !== session.header.cwd
            || (observation.header.origin === 'subagent' && observation.header.delegationDepth !== parentDepth + 1)) {
            throw new Error('native-continuation: catalog inspection path is not authorized')
          }
          parent = id
          parentDepth = observation.header.delegationDepth ?? 0
        }
        if (observation === undefined || observation.header.origin !== 'subagent') throw new Error('native-continuation: inspection requires a subagent endpoint')
        return { kind: 'child', observation }
      },
      observe: (id, signal) => { this.assertParent(agent); return this.observe(id, session.id, signal, this.program.configuration(agent)) },
      deliver: async (id, message, target, wake, signal) => {
        this.assertParent(agent)
        const live = this.resident.get(id)
        if (live !== undefined) {
          if (live.parent !== agent && id !== session.id && session.header.parentSession !== id) {
            throw new Error('native-continuation: message recipient is not adjacent')
          }
          if (!wake) {
            if (live.activation.isClosing) throw new Error('native-continuation: recipient is closing')
            return live.owner.enqueue(message, target, signal)
          }
          return live.handle.enqueue(message, target, signal)
        }
        return this.program.deliver(agent, session, id, message, target, wake, signal)
      },
    }
  }

  private async catalog(agent: NativeAgent, session: Session, scope: 'children' | 'descendants',
    signal: AbortSignal): Promise<readonly NativeContinuationCandidate[]> {
    this.assertParent(agent)
    const effective = AbortSignal.any([signal, this.shutdown.signal, this.program.lifetime])
    effective.throwIfAborted()
    const cwd = this.program.configuration(agent).cwd
    if (cwd !== session.header.cwd) throw new Error('native-continuation: catalog workspace differs from its parent')
    const corpus = await this.program.storage.list({ signal: effective })
    effective.throwIfAborted()
    const children = new Map<SessionId, SessionHeader[]>()
    for (const { header } of corpus) {
      if (header.cwd !== cwd || header.parentSession === undefined) continue
      const siblings = children.get(header.parentSession) ?? []
      siblings.push(header)
      children.set(header.parentSession, siblings)
    }
    for (const siblings of children.values()) siblings.sort((a, b) =>
      a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    const result: NativeContinuationCandidate[] = []
    const seen = new Set<SessionId>([session.id])
    const pending = (children.get(session.id) ?? []).map(header => ({ header, parentDepth: session.header.delegationDepth ?? 0,
      path: [header.id] as [SessionId, ...SessionId[]] })).reverse()
    for (;;) {
      effective.throwIfAborted()
      const candidate = pending.pop()
      if (candidate === undefined) break
      if (seen.has(candidate.header.id)) throw new Error('native-continuation: catalog lineage contains a cycle')
      seen.add(candidate.header.id)
      if (candidate.header.origin === 'subagent' && candidate.header.delegationDepth !== candidate.parentDepth + 1) continue
      if (candidate.header.origin === 'subagent') {
        const live = this.program.agents.get(NativeAgentId(candidate.header.id))
        result.push({ path: candidate.path, status: live === undefined ? 'ready'
          : this.program.agents.execution(live).status === 'running' ? 'running' : 'idle' })
      }
      if (scope === 'descendants') {
        for (const header of [...children.get(candidate.header.id) ?? []].reverse()) {
          pending.push({ header, parentDepth: candidate.header.delegationDepth ?? 0,
            path: [...candidate.path, header.id] })
        }
      }
    }
    return result
  }

  private async observe(
    id: SessionId, parent: SessionId, signal: AbortSignal, defaults: Readonly<NativeSessionConfiguration>,
  ): Promise<NativeContinuationObservation> {
    const selected = await this.program.observe?.(id, signal)
    if (selected !== undefined) {
      if (selected.header.parentSession !== parent || selected.header.origin !== 'subagent') {
        throw new Error('native-continuation: observation requires a durable direct child')
      }
      return selected
    }
    let live = this.resident.get(id)
    if (live?.owner.isClosing) { await live.owner.close(); live = undefined }
    const writer = live?.owner.writer ?? await this.program.storage.open(id, 'read', { signal })
    try {
      if (writer.header.parentSession !== parent || writer.header.origin !== 'subagent') {
        throw new Error('native-continuation: observation requires a durable direct child')
      }
      const stored = live === undefined ? await writer.read(0, Number.MAX_SAFE_INTEGER, { signal }) : await live.owner.read(signal)
      return { header: writer.header, events: stored.events, inheritedEventCount: writer.inheritedEventCount,
        defaults: { ...defaults } }
    } finally { if (live === undefined) await writer.close() }
  }

  private async inspect(
    id: SessionId, signal: AbortSignal, defaults: Readonly<NativeSessionConfiguration>,
  ): Promise<NativeContinuationInspection> {
    const selected = await this.program.observe?.(id, signal)
    if (selected !== undefined) return { kind: 'child', observation: selected }
    let live = this.resident.get(id)
    if (live?.owner.isClosing) { await live.owner.close(); live = undefined }
    const diagnostic = (error: unknown): NativeContinuationInspection => {
      signal.throwIfAborted()
      if (error instanceof SessionFormatUnsupportedError) return { kind: 'diagnostic', id, reason: 'unsupported' }
      if (error instanceof SessionPersistenceCorruptionError) return { kind: 'diagnostic', id, reason: 'corrupt' }
      if (error instanceof SessionPersistenceNotFoundError) return { kind: 'diagnostic', id, reason: 'unavailable' }
      throw error
    }
    let writer
    try { writer = live?.owner.writer ?? await this.program.storage.open(id, 'read', { signal }) }
    catch (error: unknown) { return diagnostic(error) }
    try {
      if (live !== undefined) return { kind: 'child', observation: { header: writer.header,
        events: (await live.owner.read(signal)).events, inheritedEventCount: writer.inheritedEventCount,
        defaults: { ...defaults } } }
      try {
        const stored = await writer.read(0, Number.MAX_SAFE_INTEGER, { signal })
        return { kind: 'child', observation: { header: writer.header, events: stored.events,
          inheritedEventCount: writer.inheritedEventCount, defaults: { ...defaults } } }
      } catch (error: unknown) { return diagnostic(error) }
    } finally { if (live === undefined) await writer.close() }
  }

  /**
   * Retain an existing resident parent while the Program admits a descendant.
   * @param agent - exact parent Agent.
   * @returns exact ownership release, or undefined for a nonresident parent.
   */
  retainChild(agent: NativeAgent): (() => void) | undefined {
    const id = SessionId(agent.id)
    const live = this.resident.get(id)
    if (live === undefined || live.handle.agent !== agent) return undefined
    return live.activation.retainChild()
  }

  /** Close creation and delivery admission and drain resident writers and Agents. @returns the memoized shutdown transaction. */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const completion = Promise.withResolvers<void>()
    this.closing = completion.promise
    this.shutdown.abort(new Error('native-continuation: Program is closing'))
    void this.drain().then(completion.resolve, completion.reject)
    return completion.promise
  }

  private async drain(): Promise<void> {
    await Promise.allSettled([...this.starts])
    const outcomes = await Promise.allSettled([...this.resident.values()].map(value => value.handle.dispose()))
    const failures = [...this.startupCleanupFailures,
      ...outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])]
    if (failures.length !== 0) throw new AggregateError(failures, 'native-continuation: resident shutdown failed')
  }

  private assertParent(agent: NativeAgent): void {
    if (this.closing !== undefined || this.program.lifetime.aborted) throw new Error('native-continuation: Program is closing')
    if (this.program.agents.get(agent.id) !== agent) throw new Error('native-continuation: parent is not the exact live Agent')
  }

  private open(parent: NativeAgent, session: Session, request: NativeContinuationRequest,
    signal: AbortSignal): Promise<NativeSessionContinuation> {
    this.assertParent(parent)
    if (this.startingIds.has(request.id)) throw new Error('native-continuation: child creation is already pending')
    const cancellation = new AbortController()
    const startup = Promise.withResolvers<NativeSessionContinuation>()
    const releaseResidentParent = this.retainChild(parent)
    const releaseParent = this.program.agents.onDispose(parent, async () => {
      cancellation.abort(new Error('native-continuation: parent is closing'))
      await startup.promise.then(() => undefined, () => undefined)
    })
    this.startingIds.add(request.id)
    this.starts.add(startup.promise)
    const startupSignal = AbortSignal.any([signal, cancellation.signal, this.shutdown.signal, this.program.lifetime])
    const cleanup = () => {
      releaseParent()
      this.starts.delete(startup.promise)
      this.startingIds.delete(request.id)
    }
    void this.materialize(parent, session, request, startupSignal).then(startup.resolve, startup.reject)
    void startup.promise.then((handle) => {
      cleanup()
      void handle.done.then(() => { releaseResidentParent?.() }, () => { releaseResidentParent?.() })
    }, () => { cleanup(); releaseResidentParent?.() })
    return startup.promise
  }

  private async materialize(parent: NativeAgent, session: Session, request: NativeContinuationRequest,
    signal: AbortSignal): Promise<NativeSessionContinuation> {
    this.assertParent(parent)
    signal.throwIfAborted()
    if (this.resident.has(request.id) || this.program.agents.get(NativeAgentId(request.id)) !== undefined) {
      throw new Error('native-continuation: child identity is already active')
    }
    if (request.config.cwd !== session.header.cwd || request.config.cwd !== this.program.configuration(parent).cwd) {
      throw new Error('native-continuation: child workspace differs from the selected parent')
    }
    const depth = (session.header.delegationDepth ?? 0) + 1
    if (!Number.isSafeInteger(depth) || depth > request.maxDepth) throw new Error('native-continuation: child depth exceeds maxDepth')
    const resources = new ResourceOwner()
    try {
      const registration = await this.program.acquire(request.id, new NativeScope(parent.scope), parent)
      resources.own(() => registration.release())
      signal.throwIfAborted()
      const owner = request.resume
        ? await NativeContinuationSession.restore(this.program.storage, request.id, signal)
        : await NativeContinuationSession.create(this.program.storage, {
          version: SESSION_FORMAT_VERSION, id: request.id, createdAt: Date.now(), cwd: request.config.cwd, isSeeded: false,
          parentSession: session.id, origin: 'subagent', delegationDepth: depth,
          ...registration.preset === null ? {} : { agentPreset: registration.preset },
        }, signal)
      resources.own(() => owner.close())
      if (owner.session.header.parentSession !== session.id || owner.session.header.origin !== 'subagent'
        || owner.session.header.cwd !== request.config.cwd || (owner.session.header.delegationDepth ?? depth) > request.maxDepth) {
        throw new Error('native-continuation: child cannot resume under the selected parent')
      }
      const stored = await owner.read(signal)
      if (foldNativeAgentPresetFacts(owner.session.header, stored.events).preset !== registration.preset) {
        throw new Error('native-continuation: restored preset differs from the selected Agent generation')
      }
      await request.prepare?.({ agent: registration.execution.agent, own: dispose => resources.own(dispose) })
      this.assertParent(parent)
      signal.throwIfAborted()
      const ready = Promise.withResolvers<void>()
      void ready.promise.catch(() => { /* Startup failure is also reported by the resident done promise. */ })
      let published = false
      const activation = new NativeContinuationActivation(owner, registration.execution, {
        closing: () => this.program.closing?.(owner) ?? Promise.resolve(),
        run: (owned, initial, turnSignal) => this.program.run(request, owned, registration.execution.agent,
          initial, () => { published = true; ready.resolve() }, turnSignal),
        release: () => resources.dispose(),
        settled: async (result, failure) => {
          if (!published) ready.reject(failure ?? new Error('native-continuation: child closed before publication'))
          if (published && this.closing === undefined && !this.program.lifetime.aborted && this.program.agents.get(parent.id) === parent) {
            await request.onSettled?.(result, failure)
          }
        },
      }, !request.resume)
      const releaseParent = this.program.agents.onDispose(parent, () => activation.close())
      resources.own(() => { releaseParent() })
      const handle: NativeSessionContinuation = { id: request.id, agent: registration.execution.agent,
        get isClosing() { return activation.isClosing },
        ready: ready.promise, done: activation.done,
        enqueue: (message, target, admissionSignal) => activation.enqueue(message, target, admissionSignal),
        interrupt: (reason) => { activation.interrupt(reason) }, retainChild: () => activation.retainChild(),
        dispose: () => activation.close(),
      }
      const live: Resident = { request, parent, owner, activation, handle }
      this.resident.set(request.id, live)
      void handle.done.then(() => { if (this.resident.get(request.id) === live) this.resident.delete(request.id) },
        () => { if (this.resident.get(request.id) === live) this.resident.delete(request.id) })
      return handle
    } catch (error: unknown) {
      try { await resources.dispose() } catch (cleanup: unknown) {
        if (this.shutdown.signal.aborted) this.startupCleanupFailures.push(cleanup)
        throw new AggregateError([error, cleanup], 'native-continuation: startup and cleanup failed')
      }
      throw error
    }
  }
}
