/** Native Agent lifecycle, scope and asynchronous initiator attribution. */
import { InitiatorRunTracker } from './initiator-runs.ts'
export { InitiatorRunTracker } from './initiator-runs.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-session/types'
import { NativeAgentExecution } from './execution.ts'
import type { NativeAgent, NativeAgentEventDispatcher, NativeAgentId as NativeAgentIdType } from './definition.ts'

export type { NativeAgentExecution, NativeAgentExecutionStatus } from './execution.ts'
export type * from './definition.ts'
/** Branded Native Agent identity produced by the `NativeAgentId()` factory. */
export type NativeAgentId = NativeAgentIdType
export type * from './lifecycle-types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { agents: NativeAgentRegistry }
}

/** One of the Agent's ordered pending-message lists. */
export type { InboxTarget } from './inbox.ts'
import type {} from './inbox.ts'

/**
 * Brand a nonempty native Agent identity at a string input boundary.
 * @param value - raw identity supplied by an application or integration.
 * @returns the opaque native Agent identity.
 */
export function NativeAgentId(value: string): NativeAgentIdType {
  if (value.length === 0) throw new Error('native-agent: id must be nonempty')
  return brandString<NativeAgentIdType>(value)
}

interface Entry {
  readonly agent: NativeAgent
  execution: NativeAgentExecution | undefined
  announced: boolean
  readonly cleanups: Set<() => void | Promise<void>>
  release: Promise<void> | undefined
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
  private readonly entries = new Map<NativeAgentIdType, Entry>()
  private readonly initiators = new AsyncLocalStorage<NativeAgent | undefined>()
  private readonly initiatorRuns = new InitiatorRunTracker()
  private state: 'active' | 'closing' | 'disposed' = 'active'
  private disposal: Promise<void> | undefined
  private lifecycleEventsEnabled = true

  /**
   * @param events - the selected native Host's typed scoped event dispatcher.
   * @param lifetime - Host cancellation, which closes event admission before owned resources drain.
   */
  constructor(private readonly events: NativeAgentEventDispatcher, private readonly lifetime?: AbortSignal) {
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
    const entry: Entry = { agent, execution: undefined, announced: true, cleanups: new Set(), release: undefined }
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
    return () => this.release(entry)
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
  get(id: NativeAgentIdType): NativeAgent | undefined {
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
   * Obtain the unique FIFO execution and idle-maintenance owner for a registered Agent.
   * @param agent - exact available identity; copied or releasing identities are refused.
   * @returns the same execution owner across the Agent's registration lifetime.
   */
  execution(agent: NativeAgent): NativeAgentExecution {
    this.assertAccepting()
    const entry = this.entries.get(agent.id)
    if (entry?.agent !== agent || entry.release !== undefined) throw new Error('native-agent: Agent is not the registered instance')
    return entry.execution ??= new NativeAgentExecution(this, agent, this.lifetime)
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
    const errors: unknown[] = []
    const pending = [...this.entries.values()].map(entry => this.release(entry))
    try {
      const draining = this.initiatorRuns.drainReentrant()
      if (draining !== undefined) pending.push(draining)
    } catch (error: unknown) { errors.push(error) }
    for (const result of await Promise.allSettled(pending)) {
      if (result.status === 'rejected') errors.push(result.reason as unknown)
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
    if (entry.release !== undefined) return entry.release
    const completion = Promise.withResolvers<void>()
    entry.release = completion.promise
    void this.releaseInternal(entry).then(completion.resolve, completion.reject)
    return completion.promise
  }

  private async releaseInternal(entry: Entry): Promise<void> {
    if (this.entries.get(entry.agent.id) !== entry) return
    const errors: unknown[] = []
    const pending: Promise<void>[] = []
    for (const cleanup of [...entry.cleanups]) {
      entry.cleanups.delete(cleanup)
      try { pending.push(Promise.resolve(cleanup())) } catch (error: unknown) { errors.push(error) }
    }
    for (const result of await Promise.allSettled(pending)) {
      if (result.status === 'rejected') errors.push(result.reason as unknown)
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
    return this.initiatorRuns.run(() => this.initiators.run(agent, operation), isNativePromise)
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
