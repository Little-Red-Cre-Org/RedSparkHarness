/** Native Agent lifecycle, scope and asynchronous initiator attribution. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { type NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { agents: NativeAgentRegistry }
}

/** Opaque identity for one live native Agent. */
export type NativeAgentId = Branded<'NativeAgentId'>

/**
 * Brand a nonempty native Agent identity at a string input boundary.
 * @param value - raw identity supplied by an application or integration.
 * @returns the opaque native Agent identity.
 */
export function NativeAgentId(value: string): NativeAgentId {
  if (value.length === 0) throw new Error('native-agent: id must be nonempty')
  return brandString<NativeAgentId>(value)
}

/** A live Agent's identity and scope visibility; Session ownership remains in the application. */
export interface NativeAgent {
  readonly id: NativeAgentId
  readonly scope: NativeScope
}

/** Scoped event dispatch that reports native Agent lifecycle edges. */
export interface NativeAgentEventDispatcher {
  emit(scope: NativeScope, key: 'agent/created' | 'agent/disposed', agent: NativeAgent): void
}

interface Entry {
  readonly agent: NativeAgent
  announced: boolean
  readonly cleanups: Set<() => void | Promise<void>>
  release: Promise<void> | undefined
}

interface InitiatorRun {
  active: boolean
  readonly parent: InitiatorRun | undefined
}

const NO_INITIATOR_MESSAGE = 'native-agent: no initiating Agent is active'
const DISPOSED_INITIATOR_MESSAGE = 'native-agent: initiator scope is disposed'

function isNativePromise(value: unknown): value is Promise<unknown> {
  return (typeof value === 'object' && value !== null || typeof value === 'function')
    && Object.prototype.toString.call(value) === '[object Promise]'
}

/**
 * Records native Agents, emits their scoped lifecycle events, and propagates
 * the explicit initiator through native asynchronous work.
 */
export class NativeAgentRegistry {
  private readonly entries = new Map<NativeAgentId, Entry>()
  private readonly initiators = new AsyncLocalStorage<NativeAgent | undefined>()
  private readonly initiatorRuns = new AsyncLocalStorage<InitiatorRun>()
  private state: 'active' | 'closing' | 'disposed' = 'active'
  private activeInitiatorRuns = 0
  private initiatorDrain: PromiseWithResolvers<void> | undefined
  private disposal: Promise<void> | undefined
  private lifecycleEventsEnabled = true

  /**
   * @param events - the selected native Host's typed scoped event dispatcher.
   * @param lifetime - Host cancellation, which closes event admission before owned resources drain.
   */
  constructor(private readonly events: NativeAgentEventDispatcher, lifetime?: AbortSignal) {
    const disableEvents = (): void => { this.lifecycleEventsEnabled = false }
    if (lifetime?.aborted) disableEvents()
    else lifetime?.addEventListener('abort', disableEvents, { once: true })
  }

  /**
   * Return the inherited initiator, or undefined outside an initiator boundary.
   * @returns the active initiator when one is inherited.
   */
  currentInitiator(): NativeAgent | undefined {
    this.assertReadable()
    return this.initiators.getStore()
  }

  /**
   * Return the inherited initiator or reject an agentless operation.
   * @returns the active initiator.
   */
  requireInitiator(): NativeAgent {
    const agent = this.currentInitiator()
    if (agent === undefined) throw new Error(NO_INITIATOR_MESSAGE)
    return agent
  }

  /**
   * Preserve `agent` across the operation's returned Promise without assigning
   * resource ownership or authorization to the Agent.
   * @param agent - exact live Agent that initiated the operation.
   * @param operation - synchronous or asynchronous work to run with that Agent.
   * @returns the exact value returned by `operation`.
   */
  withInitiator<T>(agent: NativeAgent, operation: () => T): T {
    return this.runWithInitiator(agent, operation)
  }

  /**
   * Hide an inherited initiator while starting agentless shared work.
   * @param operation - synchronous or asynchronous work to run without an Agent.
   * @returns the exact value returned by `operation`.
   */
  withoutInitiator<T>(operation: () => T): T {
    return this.runWithInitiator(undefined, operation)
  }

  /**
   * Register an exact Agent identity and announce it in its own NativeScope.
   * @param agent - live Agent identity and visibility scope.
   * @returns an idempotent disposer for this exact registration.
   */
  register(agent: NativeAgent): () => Promise<void> {
    this.assertAccepting()
    if (this.entries.has(agent.id)) throw new Error(`native-agent: Agent "${agent.id}" is already registered`)
    const entry: Entry = { agent, announced: true, cleanups: new Set(), release: undefined }
    this.entries.set(agent.id, entry)
    try {
      this.events.emit(agent.scope, 'agent/created', agent)
    } catch (error) {
      try {
        this.detach(entry)
      } catch (disposalError) {
        throw new AggregateError([error, disposalError], `native-agent: Agent "${agent.id}" announcement and disposal failed`)
      }
      throw error
    }
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      await this.release(entry)
    }
  }

  /**
   * Register one asynchronous cleanup that completes before its Agent leaves the registry.
   * @param agent - exact live Agent whose release owns the cleanup.
   * @param cleanup - idempotent resource release, such as draining the Agent's jobs.
   * @returns a disposer that removes this cleanup while the Agent remains live.
   */
  onDispose(agent: NativeAgent, cleanup: () => void | Promise<void>): () => void {
    this.assertAccepting()
    const entry = this.entries.get(agent.id)
    if (entry?.agent !== agent || entry.release !== undefined) {
      throw new Error(`native-agent: Agent ${JSON.stringify(agent.id)} is not the registered instance`)
    }
    entry.cleanups.add(cleanup)
    return () => { entry.cleanups.delete(cleanup) }
  }

  /**
   * Return the live Agent selected by its exact identity.
   * @param id - opaque identity to resolve.
   * @returns the matching Agent while its registration is live.
   */
  get(id: NativeAgentId): NativeAgent | undefined {
    const entry = this.entries.get(id)
    return entry?.release === undefined ? entry?.agent : undefined
  }

  /**
   * Return a detached registration-order snapshot.
   * @returns live Agents in registration order.
   */
  list(): NativeAgent[] {
    return [...this.entries.values()].flatMap(entry => entry.release === undefined ? [entry.agent] : [])
  }

  /**
   * Stop new initiator boundaries, drain returned Promise operations, and
   * announce disposal for registrations the owner did not release first.
   */
  dispose(): Promise<void> {
    return this.disposal ??= this.disposeInternal()
  }

  private async disposeInternal(): Promise<void> {
    if (this.state === 'active') this.state = 'closing'
    this.releaseReentrantInitiatorRuns()
    if (this.activeInitiatorRuns !== 0) {
      this.initiatorDrain ??= Promise.withResolvers<void>()
      await this.initiatorDrain.promise
    }
    const errors: unknown[] = []
    for (const entry of [...this.entries.values()]) {
      try {
        await this.release(entry)
      } catch (error) {
        errors.push(error)
      }
    }
    this.state = 'disposed'
    this.initiators.disable()
    this.initiatorRuns.disable()
    if (errors.length > 0) throw new AggregateError(errors, 'native-agent: Agent disposal failed')
  }

  private detach(entry: Entry): void {
    if (this.entries.get(entry.agent.id) !== entry) return
    this.entries.delete(entry.agent.id)
    if (entry.announced && this.lifecycleEventsEnabled) this.events.emit(entry.agent.scope, 'agent/disposed', entry.agent)
  }

  private release(entry: Entry): Promise<void> {
    return entry.release ??= this.releaseInternal(entry)
  }

  private async releaseInternal(entry: Entry): Promise<void> {
    if (this.entries.get(entry.agent.id) !== entry) return
    const errors: unknown[] = []
    for (const cleanup of [...entry.cleanups]) {
      entry.cleanups.delete(cleanup)
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      this.detach(entry)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) throw new AggregateError(errors, `native-agent: Agent ${JSON.stringify(entry.agent.id)} cleanup failed`)
  }

  private runWithInitiator<T>(agent: NativeAgent | undefined, operation: () => T): T {
    this.assertAccepting()
    const run: InitiatorRun = { active: true, parent: this.initiatorRuns.getStore() }
    this.activeInitiatorRuns += 1
    let result: T
    try {
      result = this.initiatorRuns.run(run, () => this.initiators.run(agent, operation))
    } catch (error) {
      this.releaseInitiatorRun(run)
      throw error
    }
    if (isNativePromise(result)) {
      try {
        void Promise.prototype.then.call(result, () => { this.releaseInitiatorRun(run) }, () => { this.releaseInitiatorRun(run) })
      } catch {
        this.releaseInitiatorRun(run)
      }
    } else {
      this.releaseInitiatorRun(run)
    }
    return result
  }

  private releaseReentrantInitiatorRuns(): void {
    let run = this.initiatorRuns.getStore()
    while (run !== undefined) {
      this.releaseInitiatorRun(run)
      run = run.parent
    }
  }

  private releaseInitiatorRun(run: InitiatorRun): void {
    if (!run.active) return
    run.active = false
    this.activeInitiatorRuns -= 1
    if (this.activeInitiatorRuns !== 0) return
    this.initiatorDrain?.resolve()
    this.initiatorDrain = undefined
  }

  private assertAccepting(): void {
    if (this.state !== 'active') throw new Error(DISPOSED_INITIATOR_MESSAGE)
  }

  private assertReadable(): void {
    if (this.state === 'disposed') throw new Error(DISPOSED_INITIATOR_MESSAGE)
  }
}

/** Native Agent lifecycle Provider with no configuration surface. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-agent', targets: ['host'],
  requires: [], provides: ['agents'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('native-agent: configuration must be empty')
    }
    return (context) => {
      const registry = new NativeAgentRegistry(context.events, context.signal)
      context.own(() => registry.dispose())
      context.provide('agents', registry)
    }
  },
}
