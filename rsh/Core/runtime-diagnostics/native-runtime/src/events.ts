/** Typed, scope-filtered event delivery with explicit dispatch modes. */
import { NativeScope } from './scope.ts'

/** A declaration fixes delivery mode, payload, and waterfall result independently of Cordis. */
export interface EventDeclaration<Args extends unknown[] = unknown[], Result = void> {
  mode: 'sync' | 'parallel' | 'serial' | 'waterfall'
  args: Args
  result: Result
}

/** Extend in the event-owning package; each member has one EventDeclaration. */
export interface NativeEvents {}

/** Event names contributed by declaration merging. */
export type EventKey = keyof NativeEvents
type Key = EventKey
type Args<K extends Key> = NativeEvents[K] extends EventDeclaration<infer A, unknown> ? A : never
type Result<K extends Key> = NativeEvents[K] extends EventDeclaration<unknown[], infer R> ? R : never
type Mode<K extends Key> = NativeEvents[K] extends { mode: infer M } ? M : never
type ModeKeys<M extends string> = { [K in Key]: Mode<K> extends M ? K : never }[Key]
/** Callback parameters and result selected by an event's declared mode. */
export type EventListener<K extends Key> = Mode<K> extends 'waterfall'
  ? (...args: [...Args<K>, () => Promise<Result<K>>]) => Result<K> | Promise<Result<K>>
  : (...args: Args<K>) => Mode<K> extends 'sync' ? void : void | Promise<void>

interface Registration {
  scope: NativeScope
  listener: (...args: unknown[]) => unknown
  active: boolean
  pending: Set<Promise<unknown>>
}

/** A bus per installation host; exceptions propagate unless the event owner handles them. */
export class RuntimeEvents {
  private readonly listeners = new Map<Key, Registration[]>()
  private readonly pending = new Set<Promise<unknown>>()
  private closed = false

  private async invoke(entry: Registration, work: () => unknown): Promise<unknown> {
    const task = Promise.resolve().then(work)
    entry.pending.add(task)
    try { return await task } finally { entry.pending.delete(task) }
  }

  private admit(): void {
    if (this.closed) throw new Error('native-runtime: event bus is closed')
  }

  private async track<T>(work: () => Promise<T>): Promise<T> {
    this.admit()
    const task = Promise.resolve().then(work)
    this.pending.add(task)
    try { return await task } finally { this.pending.delete(task) }
  }

  /**
   * Stop subscriptions and dispatch immediately, then await admitted callbacks.
   * @returns completion of admitted work; dispatch callers retain their errors.
   */
  async close(): Promise<void> {
    this.closed = true
    for (const entries of this.listeners.values()) for (const entry of entries) entry.active = false
    this.listeners.clear()
    await Promise.allSettled(this.pending)
  }

  /**
   * Subscribe in registration order; descendant dispatches reach ancestor listeners.
   * @param scope - registration visibility scope.
   * @param key - declared event name.
   * @param listener - callback matching the declaration's delivery mode.
   * @returns a disposer that removes admission immediately and awaits admitted asynchronous calls.
   */
  on<K extends Key>(scope: NativeScope, key: K, listener: EventListener<K>): () => Promise<void> {
    this.admit()
    const entry: Registration = { scope, listener: listener as Registration['listener'], active: true, pending: new Set() }
    const entries = this.listeners.get(key) ?? []
    entries.push(entry)
    this.listeners.set(key, entries)
    return async () => {
      if (entry.active) {
        entry.active = false
        entries.splice(entries.indexOf(entry), 1)
        if (entries.length === 0) this.listeners.delete(key)
      }
      await Promise.allSettled(entry.pending)
    }
  }

  private selected(scope: NativeScope, key: Key): Registration[] {
    return (this.listeners.get(key) ?? []).filter(entry => entry.scope.contains(scope))
  }

  /**
   * Deliver synchronously; a thrown error stops delivery and reaches the caller.
   * @param scope - event subject scope.
   * @param key - synchronous event name.
   * @param args - declared event payload.
   */
  emit<K extends ModeKeys<'sync'>>(scope: NativeScope, key: K, ...args: Args<K>): void {
    this.admit()
    for (const entry of this.selected(scope, key)) {
      if (entry.active) entry.listener(...args)
    }
  }

  /**
   * Await every listener before reporting all failures; no detached work survives settlement.
   * @param scope - event subject scope.
   * @param key - parallel event name.
   * @param args - declared event payload.
   * @returns completion of every admitted listener.
   */
  async parallel<K extends ModeKeys<'parallel'>>(scope: NativeScope, key: K, ...args: Args<K>): Promise<void> {
    const entries = this.selected(scope, key)
    await this.track(async () => {
      const results = await Promise.allSettled(entries.map(async (entry) => {
        if (entry.active) await this.invoke(entry, () => entry.listener(...args))
      }))
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (errors.length > 0) throw new AggregateError(errors, `native-runtime: ${String(key)} listeners failed`)
    })
  }

  /**
   * Await listeners in registration order; rejection stops delivery.
   * @param scope - event subject scope.
   * @param key - serial event name.
   * @param args - declared event payload.
   * @returns sequential delivery completion.
   */
  async serial<K extends ModeKeys<'serial'>>(scope: NativeScope, key: K, ...args: Args<K>): Promise<void> {
    const entries = this.selected(scope, key)
    await this.track(async () => {
      for (const entry of entries) {
        if (entry.active) await this.invoke(entry, () => entry.listener(...args))
      }
    })
  }

  /**
   * Delegate only through next(); calling next twice rejects before repeated downstream effects.
   * @param scope - event subject scope.
   * @param key - waterfall event name.
   * @param terminal - explicit behavior after the last listener.
   * @param args - declared event payload.
   * @returns the outermost listener result, or the terminal result.
   */
  async waterfall<K extends ModeKeys<'waterfall'>>(
    scope: NativeScope, key: K, terminal: () => Result<K> | Promise<Result<K>>, ...args: Args<K>
  ): Promise<Result<K>> {
    const entries = this.selected(scope, key)
    const dispatch = async (index: number): Promise<Result<K>> => {
      this.admit()
      const entry = entries[index]
      if (entry === undefined) return terminal()
      if (!entry.active) return dispatch(index + 1)
      let downstream: Promise<Result<K>> | undefined
      const next = () => {
        if (downstream !== undefined) throw new Error(`native-runtime: ${String(key)} next() called twice`)
        downstream = dispatch(index + 1)
        // A listener may start next() before awaiting other work; retain rejection ownership.
        void downstream.catch(() => undefined)
        return downstream
      }
      return await this.invoke(entry, async () => {
        try {
          return await entry.listener(...args, next)
        } finally {
          // The listener owns recovery from next(); draining must preserve its result or error.
          await downstream?.then(() => undefined, () => undefined)
        }
      }) as Result<K>
    }
    return this.track(() => dispatch(0))
  }
}
