/** Hierarchical visibility and installation-owned asynchronous cleanup. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Release one owned resource; completion means the resource is quiescent. */
export type Disposer = () => void | Promise<void>

/** Opaque identity for one visibility scope. */
export type NativeScopeId = Branded<'NativeScopeId'>

/** Identity-based visibility tree; constructing a new root creates an isolated realm. */
export class NativeScope {
  /** Stable diagnostic identity without exposing attached scope data. */
  readonly id = brandString<NativeScopeId>(globalThis.crypto.randomUUID())
  /** @param parent - enclosing scope, omitted for an isolated root. */
  constructor(readonly parent?: NativeScope) {}

  /**
   * Test whether registrations in this scope are visible from a descendant.
   * @param scope - dispatch or service lookup scope.
   * @returns whether this scope is in its ancestry, including itself.
   */
  contains(scope: NativeScope): boolean {
    for (let current: NativeScope | undefined = scope; current !== undefined; current = current.parent) {
      if (current === this) return true
    }
    return false
  }
}

/** One activation's resources; all disposers run even when a preceding one fails. */
export class ResourceOwner {
  /** Cancellation requested before this owner's resources are released. */
  readonly controller = new AbortController()
  private readonly resources: Disposer[] = []
  private readonly pending = new Set<Promise<void>>()
  private disposal: Promise<void> | undefined

  /**
   * Retain dispatcher completion before releasing resources used by its callbacks.
   * @param completion - subscription drain that settles after admission is closed.
   */
  waitFor(completion: Promise<void>): void {
    this.pending.add(completion)
    void completion.then(() => this.pending.delete(completion), () => this.pending.delete(completion))
  }

  /**
   * Record cleanup immediately after acquiring a resource, including during cancelled startup.
   * @param dispose - release operation owned exclusively by this activation.
   * @returns an idempotent, awaitable release operation.
   */
  own(dispose: Disposer): () => Promise<void> {
    if (this.disposal !== undefined) throw new Error('native-runtime: resource owner is already disposing')
    let completion: Promise<void> | undefined
    const release = () => completion ??= Promise.resolve().then(dispose)
    this.resources.push(release)
    return release
  }

  /**
   * Own a registration whose cancellation closes admission before acquired resources are released.
   * @param dispose - registration removal and completion of its admitted callbacks.
   * @returns the shared, idempotent registration drain.
   */
  effect(dispose: Disposer): () => Promise<void> {
    let completion: Promise<void> | undefined
    const release = () => {
      if (completion !== undefined) return completion
      const drain = Promise.withResolvers<void>()
      completion = drain.promise
      try { drain.resolve(dispose()) } catch (error) { drain.reject(error) }
      return completion
    }
    this.own(release)
    const cancel = () => { this.waitFor(release()) }
    this.controller.signal.addEventListener('abort', cancel, { once: true })
    this.own(() => { this.controller.signal.removeEventListener('abort', cancel) })
    if (this.controller.signal.aborted) cancel()
    return release
  }

  /**
   * Release resources in reverse acquisition order after activation settles.
   * @returns the shared completion, rejecting with all cleanup failures.
   */
  dispose(): Promise<void> {
    this.controller.abort()
    return this.disposal ??= Promise.resolve().then(async () => {
      await Promise.allSettled(this.pending)
      const errors: unknown[] = []
      for (const dispose of this.resources.reverse()) {
        try { await dispose() } catch (error) { errors.push(error) }
      }
      this.resources.length = 0
      if (errors.length > 0) throw new AggregateError(errors, 'native-runtime: resource cleanup failed')
    })
  }
}
