/** Cordis-free Native Provider for durable model-request context. */
import { NativeContributions, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type {
  NativeRequestContextAcceptance,
  NativeRequestContextProvider,
  NativeRequestContextRegistration,
  NativeRequestContextRequest,
  NativeRequestContexts,
} from '@deepseek-ai/dsh-request-context-definition'

interface ProviderEntry {
  readonly provider: NativeRequestContextProvider
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  readonly unregister: () => void
  closed: boolean
  disposal?: Promise<void>
}

/** Scope-aware request-context registry; each request remains owned by its exact selected Program. */
export class NativeRequestContextRegistry implements NativeRequestContexts {
  private readonly providers: NativeContributions<ProviderEntry>
  private readonly entries = new Set<ProviderEntry>()
  private readonly pending = new Set<Promise<void>>()
  private disposed = false
  private disposal: Promise<void> | undefined

  /** @param root - Provider scope containing all registrations and request scopes. */
  constructor(root: NativeScope) {
    this.providers = new NativeContributions(root)
  }

  /**
   * Register a provider in one scope; its exact disposer closes admission and drains accepted request work.
   * @param scope - registration scope in the Provider's realm.
   * @param provider - stable provider identity and request order.
   * @returns idempotent removal and drain for this exact provider registration.
   */
  register(scope: NativeScope, provider: NativeRequestContextProvider): NativeRequestContextRegistration {
    if (this.disposed) throw new Error('request-context: registry is disposed')
    if (!Number.isSafeInteger(provider.order)) throw new Error('request-context: provider order must be a safe integer')
    let remove = (): void => {}
    const entry: ProviderEntry = {
      provider, controller: new AbortController(), pending: new Set(), unregister: () => { remove() }, closed: false,
    }
    remove = this.providers.register(provider.id, entry, scope)
    this.entries.add(entry)
    return Object.assign(() => this.close(entry), {
      isVisible: (requestScope: NativeScope) => !this.disposed
        && !entry.closed && this.providers.visible(requestScope).get(provider.id) === entry,
    })
  }

  /** @param scope - dynamic Agent scope to inspect. @returns whether any provider is visible. */
  hasProviders(scope: NativeScope): boolean {
    return this.providers.visible(scope).size !== 0
  }

  /**
   * Prepare the visible provider set and delegate one durable commit to the owning Program.
   * @param request - exact active owner, durable event snapshot and final tool visibility.
   * @param accept - the Program's single append-and-flush path.
   * @returns the durable acceptance result; any preparation or acceptance failure propagates.
   */
  async prepareAndAccept(
    request: NativeRequestContextRequest,
    accept: (messages: readonly UserMessage[]) => Promise<NativeRequestContextAcceptance>,
  ): Promise<NativeRequestContextAcceptance> {
    if (this.disposed) throw new Error('request-context: registry is disposed')
    request.signal.throwIfAborted()
    const entries = [...this.providers.visible(request.scope).values()]
      .sort((left, right) => left.provider.order - right.provider.order || compareIds(left.provider.id, right.provider.id))
    const requestCompletion = Promise.withResolvers<void>()
    this.pending.add(requestCompletion.promise)
    const completions = entries.map((entry) => {
      const completion = Promise.withResolvers<void>()
      entry.pending.add(completion.promise)
      return { entry, completion }
    })
    try {
      const outcomes = await Promise.allSettled(entries.map(entry => Promise.resolve().then(() => entry.provider.prepare({
        ...request,
        signal: AbortSignal.any([request.signal, entry.controller.signal]),
      }))))
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'request-context: provider preparation failed')
      request.signal.throwIfAborted()
      const visible = this.providers.visible(request.scope)
      if (this.isDisposed() || entries.some(entry => entry.closed || visible.get(entry.provider.id) !== entry)) {
        return 'rejected'
      }
      const prepared = outcomes.map((outcome) => {
        if (outcome.status === 'rejected') throw outcome.reason
        return outcome.value
      })
      const messages = prepared.flatMap(item => item.messages)
      const result = await accept(messages)
      if (result === 'accepted') for (const item of prepared) item.commit()
      return result
    } finally {
      for (const { entry, completion } of completions) {
        entry.pending.delete(completion.promise)
        completion.resolve()
      }
      this.pending.delete(requestCompletion.promise)
      requestCompletion.resolve()
    }
  }

  /** Close registration admission and wait for every request that captured the entry. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    const entries = [...this.entries]
    const requests = [...this.pending]
    return this.disposal = Promise.all([...entries.map(entry => this.close(entry)), ...requests]).then(() => undefined)
  }

  private close(entry: ProviderEntry): Promise<void> {
    if (entry.disposal !== undefined) return entry.disposal
    entry.closed = true
    entry.unregister()
    entry.controller.abort(new Error('request-context: provider registration is disposed'))
    return entry.disposal = Promise.allSettled([...entry.pending]).then(() => { this.entries.delete(entry) })
  }

  private isDisposed(): boolean {
    return this.disposed
  }
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
