/** Exact active Session routing and drained lifecycle notifications without execution ownership. */
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from './active-session.ts'

interface Observer {
  readonly callback: (owner: NativeActiveSessionOwner) => Promise<void>
  readonly pending: Set<Promise<void>>
}

interface Entry {
  readonly owner: NativeActiveSessionOwner
  readonly attached: PromiseWithResolvers<void>
  readonly cleanup: () => void
  release: Promise<void> | undefined
}

/** The Program retains the only writer; this registry publishes exact ownership and drains Consumers. */
export class NativeActiveSessionRegistry implements NativeActiveSessionOperations {
  private readonly knownAgents = new WeakSet<NativeAgent>()
  private readonly entries = new Map<NativeAgent, Entry>()
  private readonly attached = new Set<Observer>()
  private readonly detached = new Set<Observer>()
  private readonly pending = new Set<Promise<void>>()
  private readonly releases = new Set<Promise<void>>()
  private closing = false
  private disposal: Promise<void> | undefined

  /** @param agents - exact live Agent authority; Session ownership remains in the selected Program. */
  constructor(private readonly agents: NativeAgentRegistry) {}

  /** @inheritdoc */
  async register(owner: NativeActiveSessionOwner): Promise<() => Promise<void>> {
    if (this.closing) throw new Error('native-active-session: registry is closing')
    if (this.agents.get(owner.agent.id) !== owner.agent || owner.agent.id !== NativeAgentId(owner.session.id) || !owner.writerAvailable) {
      throw new Error('native-active-session: registration requires the exact live Agent and writable Session')
    }
    if (this.entries.has(owner.agent)) throw new Error('native-active-session: Agent already has an active Session owner')
    const attached = Promise.withResolvers<void>()
    const entry: Entry = { owner, attached, cleanup: this.agents.onDispose(owner.agent, () => this.release(entry)), release: undefined }
    this.knownAgents.add(owner.agent)
    this.entries.set(owner.agent, entry)
    try {
      await this.notify(this.attached, owner)
      attached.resolve()
    } catch (failure: unknown) {
      attached.resolve()
      try { await this.release(entry) } catch (cleanup: unknown) {
        throw new AggregateError([failure, cleanup], 'native-active-session: attach and rollback failed')
      }
      throw failure
    }
    if (!this.accepting(entry)) {
      await this.release(entry)
      throw new Error('native-active-session: owner closed during attachment')
    }
    return () => this.release(entry)
  }

  /** @inheritdoc */
  owner(agent: NativeAgent, session: Session): NativeActiveSessionOwner | undefined {
    const live = this.agents.get(agent.id)
    if (live !== agent) {
      if (live === undefined && this.knownAgents.has(agent)) return undefined
      throw new Error('native-active-session: Agent is not the exact live instance')
    }
    const entry = this.entries.get(agent)
    if (entry === undefined || entry.release !== undefined || this.closing || !entry.owner.writerAvailable) return undefined
    if (entry.owner.session !== session) throw new Error('native-active-session: Session is not the exact active instance')
    return entry.owner
  }

  /** @inheritdoc */
  owners(): readonly NativeActiveSessionOwner[] {
    if (this.closing) return []
    return [...this.entries.values()]
      .filter(entry => this.accepting(entry) && this.agents.get(entry.owner.agent.id) === entry.owner.agent)
      .map(entry => entry.owner)
  }

  /** @inheritdoc */
  onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>): () => Promise<void> {
    return this.observe(this.attached, observer)
  }

  /** @inheritdoc */
  onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>): () => Promise<void> {
    return this.observe(this.detached, observer)
  }

  /** Close lookup and lifecycle admission and drain accepted owners. @returns the memoized quiescent release. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    const completed = Promise.withResolvers<void>()
    this.disposal = completed.promise
    void (async () => {
      for (const entry of [...this.entries.values()]) void this.release(entry)
      const owners = await Promise.allSettled([...this.releases])
      this.attached.clear()
      this.detached.clear()
      await Promise.allSettled([...this.pending])
      const failures = owners.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'native-active-session: owner release failed')
    })().then(completed.resolve, completed.reject)
    return completed.promise
  }

  private accepting(entry: Entry): boolean {
    return entry.release === undefined && !this.closing && entry.owner.writerAvailable
  }

  private release(entry: Entry): Promise<void> {
    if (entry.release !== undefined) return entry.release
    const completed = Promise.withResolvers<void>()
    entry.release = completed.promise
    this.releases.add(completed.promise)
    const settled = (): void => { this.releases.delete(completed.promise) }
    void completed.promise.then(settled, settled)
    void (async () => {
      try {
        await entry.attached.promise
        await this.notify(this.detached, entry.owner)
      } finally {
        entry.cleanup()
        if (this.entries.get(entry.owner.agent) === entry) this.entries.delete(entry.owner.agent)
      }
    })().then(completed.resolve, completed.reject)
    return completed.promise
  }

  private observe(collection: Set<Observer>, callback: Observer['callback']): () => Promise<void> {
    if (this.closing) throw new Error('native-active-session: registry is closing')
    const observer: Observer = { callback, pending: new Set() }
    collection.add(observer)
    let release: Promise<void> | undefined
    return () => {
      collection.delete(observer)
      return release ??= Promise.allSettled([...observer.pending]).then(() => {})
    }
  }

  private async notify(collection: Set<Observer>, owner: NativeActiveSessionOwner): Promise<void> {
    const operations = [...collection].map((observer) => {
      const operation = Promise.resolve().then(() => observer.callback(owner))
      observer.pending.add(operation)
      this.pending.add(operation)
      const settled = (): void => { observer.pending.delete(operation); this.pending.delete(operation) }
      void operation.then(settled, settled)
      return operation
    })
    const results = await Promise.allSettled(operations)
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'native-active-session: lifecycle observer failed')
  }
}
