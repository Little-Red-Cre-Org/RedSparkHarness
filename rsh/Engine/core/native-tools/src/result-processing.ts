/** Owned asynchronous policy registrations and exactly-once waterfall delegation. */
import type { NativeContributions, NativeScope } from '@deepseek-ai/dsh-native-runtime'

/** One captured policy whose removal cancels and drains its accepted operations. */
export interface AsyncPolicyRegistration<T> {
  readonly policy: T
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  /** @returns settlement after synchronous removal and cancellation. */
  dispose(): Promise<void>
}

/**
 * Register an asynchronous policy with independent admission and lifecycle ownership.
 * @param contributions - scoped policy collection.
 * @param registrations - owner collection used during registry disposal.
 * @param key - unique contribution key.
 * @param policy - installed callback.
 * @param scope - installation visibility scope.
 * @returns exact registration and its awaitable disposer.
 */
export function registerAsyncPolicy<T>(
  contributions: NativeContributions<AsyncPolicyRegistration<T>>, registrations: Set<AsyncPolicyRegistration<T>>,
  key: string, policy: T, scope?: NativeScope,
): AsyncPolicyRegistration<T> {
  let completion: Promise<void> | undefined
  const entry: AsyncPolicyRegistration<T> = {
    policy, controller: new AbortController(), pending: new Set(),
    dispose: () => {
      if (completion !== undefined) return completion
      completion = Promise.resolve().then(async () => {
        await Promise.allSettled([...entry.pending])
        registrations.delete(entry)
      })
      unregister()
      entry.controller.abort()
      return completion
    },
  }
  const unregister = contributions.register(key, entry, scope)
  registrations.add(entry)
  return entry
}

/**
 * Await every delegated branch and report independent listener and downstream failures.
 * @param count - number of captured policies.
 * @param original - terminal waterfall value.
 * @param signal - independently owned cancellation checked before callback entry.
 * @param invoke - one callback receiving an exactly-once downstream delegate.
 * @returns the value selected by the completed waterfall.
 */
export function processAsyncWaterfall<T>(
  count: number, original: T, signal: AbortSignal, invoke: (index: number, next: () => Promise<T>) => Promise<T>,
): Promise<T> {
  const delegate = async (index: number): Promise<T> => {
    signal.throwIfAborted()
    if (index === count) return original
    let downstream: Promise<T> | undefined
    let primary: { error: unknown } | undefined
    let selected!: T
    try {
      selected = await invoke(index, () => {
        if (downstream !== undefined) throw new Error('native-tools: result policy delegated more than once')
        downstream = delegate(index + 1)
        return downstream
      })
      if (downstream === undefined) throw new Error('native-tools: result policy did not delegate')
    } catch (error: unknown) { primary = { error } }
    if (downstream !== undefined) {
      try { await downstream }
      catch (error: unknown) {
        if (primary === undefined) primary = { error }
        else if (primary.error !== error) primary = { error: new AggregateError([primary.error, error], 'result policies failed') }
      }
    }
    if (primary !== undefined) throw primary.error
    return selected
  }
  return delegate(0)
}
