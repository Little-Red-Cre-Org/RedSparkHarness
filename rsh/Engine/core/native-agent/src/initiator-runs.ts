/** Returned-Promise lifetime tracking shared by native and compatibility Agent registries. */
import { AsyncLocalStorage } from 'node:async_hooks'

interface InitiatorRun {
  active: boolean
  readonly parent: InitiatorRun | undefined
}

/** Counts nested initiator operations without owning Agent attribution or admission. */
export class InitiatorRunTracker {
  private readonly runs = new AsyncLocalStorage<InitiatorRun>()
  private active = 0
  private completion: PromiseWithResolvers<undefined> | undefined

  /** Track an operation while preserving its exact return identity.
   * @param operation - registry-owned attribution boundary.
   * @param isPromise - the registry's existing returned-Promise classification.
   * @returns the exact synchronous value or Promise returned by the operation.
   */
  run<T>(operation: () => T, isPromise: (value: unknown) => boolean): T {
    const run: InitiatorRun = { active: true, parent: this.runs.getStore() }
    this.active += 1
    let result: T
    try { result = this.runs.run(run, operation) } catch (error: unknown) {
      this.release(run)
      throw error
    }
    if (isPromise(result)) {
      try {
        void Promise.prototype.then.call(result, () => { this.release(run) }, () => { this.release(run) })
      } catch {
        // A branded Promise's failing species prevents attachment; retain its exact return without leaking the run.
        this.release(run)
      }
    } else this.release(run)
    return result
  }

  /** Exclude the teardown's current nesting chain and wait for unrelated operations.
   * @returns pending completion, or undefined when nothing remains to drain.
   */
  drainReentrant(): Promise<void> | undefined {
    let run = this.runs.getStore()
    while (run !== undefined) {
      this.release(run)
      run = run.parent
    }
    if (this.active === 0) return undefined
    this.completion ??= Promise.withResolvers<undefined>()
    return this.completion.promise
  }

  /** Disable asynchronous run tracking after admission is closed and draining completes. */
  disable(): void { this.runs.disable() }

  private release(run: InitiatorRun): void {
    if (!run.active) return
    run.active = false
    this.active -= 1
    if (this.active !== 0) return
    this.completion?.resolve(undefined)
    this.completion = undefined
  }
}
