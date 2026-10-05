/** Native Client rebuilds retain published assets until a complete successor is ready. */
import { watch, type FSWatcher } from 'chokidar'
import { NativeClientBuildError, type NativeClientBundle } from '@deepseek-ai/dsh-native-web-assets'

interface DirectoryObservation {
  readonly watcher: FSWatcher
  readonly ready: Promise<void>
  close(): Promise<void>
}

/** Own exact input directories, serialized rebuilds and watcher shutdown. */
export class NativeClientReloader {
  private observation: DirectoryObservation
  private directories: Set<string>
  private successor: DirectoryObservation | undefined
  private requested = false
  private closing = false
  private pending: Promise<void> | undefined
  private closed: Promise<void> | undefined
  private readonly cleanupFailures: unknown[] = []

  /**
   * @param initial - validated published graph and its Host-only input directories.
   * @param build - rebuild the selected profile without changing published assets.
   * @param publish - atomically publish a complete validated successor.
   * @param report - report failed rebuilds while retaining the current graph.
   */
  constructor(
    initial: NativeClientBundle,
    private readonly build: () => Promise<NativeClientBundle | undefined>,
    private readonly publish: (bundle: NativeClientBundle) => void,
    private readonly report: (error: unknown) => void,
  ) {
    this.directories = new Set(initial.watchDirectories)
    this.observation = this.observe(this.directories)
  }

  private observe(directories: ReadonlySet<string>): DirectoryObservation {
    const watcher = watch([...directories], { ignoreInitial: true, persistent: false, depth: 0, followSymlinks: false })
    const readiness = Promise.withResolvers<undefined>()
    let closed: Promise<void> | undefined
    watcher.once('ready', () => { readiness.resolve(undefined) })
    watcher.on('error', (error) => { readiness.reject(error); if (!this.stopped()) this.report(error) })
    watcher.on('all', () => { void this.refresh() })
    // The owner awaits readiness at startup or graph replacement; shutdown may cancel it first.
    void readiness.promise.catch(() => undefined)
    return { watcher, ready: readiness.promise, close: () => {
      readiness.reject(new Error('Native Client input observation closed'))
      return closed ??= watcher.close()
    } }
  }

  /**
   * Observe watcher readiness and reread inputs changed during initial compilation.
   * @returns completion of initial dependency observation and reconciliation.
   */
  async ready(): Promise<void> { await this.observation.ready; await this.refresh() }

  private stopped(): boolean { return this.closing }

  private async observeSuccessor(next: Set<string>): Promise<boolean> {
    if (next.size === this.directories.size && [...next].every(directory => this.directories.has(directory))) return false
    const observation = this.observe(next)
    this.successor = observation
    try {
      await observation.ready
      if (this.stopped()) return true
      const previous = this.observation
      this.observation = observation
      this.successor = undefined
      this.directories = next
      // Compile again after the new observation is ready, before publishing bytes read earlier.
      this.requested = true
      try { await previous.close() } catch (error) { this.cleanupFailures.push(error); throw error }
      return true
    } finally {
      if (this.successor === observation) {
        this.successor = undefined
        try { await observation.close() } catch (error) { this.cleanupFailures.push(error) }
      }
    }
  }

  /**
   * Coalesce queued changes without overlapping builds or adopting a result after shutdown.
   * @returns the current accepted rebuild drain.
   */
  refresh(): Promise<void> {
    if (this.stopped()) return Promise.resolve()
    this.requested = true
    if (this.pending !== undefined) return this.pending
    this.pending = (async () => {
      while (this.requested && !this.closing) {
        this.requested = false
        try {
          const candidate = await this.build()
          if (this.stopped()) return
          if (candidate === undefined) throw new Error('Native Client profile was removed')
          if (await this.observeSuccessor(new Set(candidate.watchDirectories))) continue
          if (!this.stopped()) this.publish(candidate)
        } catch (error: unknown) {
          if (this.stopped()) return
          if (error instanceof NativeClientBuildError) {
            try { await this.observeSuccessor(new Set([...this.directories, ...error.watchDirectories])) }
            catch (observationError) {
              this.cleanupFailures.push(observationError)
              if (!this.stopped()) this.report(new AggregateError([error, observationError], 'Native Client recovery observation failed'))
              continue
            }
          }
          if (!this.stopped()) this.report(error)
        }
      }
    })().finally(() => { this.pending = undefined })
    return this.pending
  }

  /**
   * Stop change admission and await watchers and the accepted build.
   * @returns the same shutdown promise, including every resource cleanup failure.
   */
  close(): Promise<void> {
    if (this.closed !== undefined) return this.closed
    this.closing = true
    const drain = this.pending
    const observations = [this.observation, this.successor]
    this.closed = (async () => {
      const outcomes = await Promise.allSettled([
        ...observations.map(observation => observation?.close()), drain,
      ])
      const failures: unknown[] = [...this.cleanupFailures]
      for (const outcome of outcomes) if (outcome.status === 'rejected') failures.push(outcome.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Native Client reload cleanup failed')
    })()
    return this.closed
  }
}
