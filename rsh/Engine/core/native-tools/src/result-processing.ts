/** Owned asynchronous policy registrations, exactly-once waterfall delegation and surrounding execution. */
import type { NativeContributions, NativeScope } from '@redspark/rsh-native-runtime'

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

/**
 * Run ordered interceptors that may stop the chain by returning without delegating.
 *
 * Unlike a result policy, an interceptor that answers without calling `next` is the
 * terminal answer: denial, request for approval and blocking feedback all end the
 * chain at the listener that decided.
 * @param count - number of captured interceptors.
 * @param signal - independently owned cancellation checked before callback entry.
 * @param terminal - answer used when the whole chain delegates through.
 * @param invoke - one interceptor receiving an exactly-once downstream delegate.
 * @returns the answer selected by the stopping interceptor, or the terminal answer.
 */
export function processInterceptionChain<D>(
  count: number, signal: AbortSignal, terminal: () => D,
  invoke: (index: number, next: () => Promise<D>) => Promise<D>,
): Promise<D> {
  const delegate = async (index: number): Promise<D> => {
    signal.throwIfAborted()
    if (index === count) return terminal()
    let downstream: Promise<D> | undefined
    let delegated = false
    let primary: { error: unknown } | undefined
    let selected!: D
    try {
      selected = await invoke(index, () => {
        if (delegated) throw new Error('native-tools: interceptor delegated more than once')
        delegated = true
        downstream = delegate(index + 1)
        return downstream
      })
    } catch (error: unknown) { primary = { error } }
    // A delegated branch is awaited for quiescence even when the listener's own answer is
    // authoritative, so a failure after the answer still reaches the caller.
    if (downstream !== undefined) {
      try { await downstream }
      catch (error: unknown) {
        if (primary === undefined) primary = { error }
        else if (primary.error !== error) primary = { error: new AggregateError([primary.error, error], 'tool interceptors failed') }
      }
    }
    if (primary !== undefined) throw primary.error
    return selected
  }
  return delegate(0)
}

/**
 * Run surrounding execution policies around one body; each policy owns the outcome it returns.
 * @param count - number of captured execution policies.
 * @param signal - admitted invocation cancellation, fused into every delegated signal.
 * @param body - terminal operation receiving the fused signal.
 * @param invoke - one policy receiving its current signal and an exactly-once downstream delegate.
 * @returns the outcome selected by the outermost policy after every delegated branch settles.
 */
export function processExecutionChain<T>(
  count: number, signal: AbortSignal, body: (signal: AbortSignal) => Promise<T>,
  invoke: (index: number, signal: AbortSignal, next: (signal: AbortSignal) => Promise<T>) => Promise<T>,
): Promise<T> {
  const delegate = async (index: number, current: AbortSignal): Promise<T> => {
    current.throwIfAborted()
    if (index === count) return body(current)
    let downstream: Promise<T> | undefined
    let primary: { error: unknown } | undefined
    let selected!: T
    try {
      selected = await invoke(index, current, (replacement) => {
        if (downstream !== undefined) throw new Error('native-tools: execution policy delegated more than once')
        if (!(replacement instanceof AbortSignal)) throw new TypeError('native-tools: execution policy must delegate an AbortSignal')
        downstream = delegate(index + 1, replacement === current ? current : AbortSignal.any([current, replacement]))
        return downstream
      })
      if (downstream === undefined) throw new Error('native-tools: execution policy did not delegate')
    } catch (error: unknown) { primary = { error } }
    // Unlike result policies, a surrounding policy may translate its downstream failure (for example a timeout),
    // so the downstream branch is awaited for quiescence while the policy's own outcome is authoritative.
    if (downstream !== undefined) await downstream.then(() => undefined, () => undefined)
    if (primary !== undefined) throw primary.error
    return selected
  }
  return delegate(0, signal)
}
