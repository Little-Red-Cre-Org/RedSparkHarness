/** Carrier-neutral bounded request cancellation and resource-cleanup drain. */

/** Admission failure before an operation or resource is acquired. */
export class NativeConnectionRequestAdmissionError extends Error {
  /** @param reason - capacity exhaustion or closed request admission. */
  constructor(readonly reason: 'capacity' | 'closed') {
    super(`native-request-owner: ${reason}`)
    this.name = 'NativeConnectionRequestAdmissionError'
  }
}

/** One Consumer's callbacks; no Session, transport registry or business state is owned here. */
export class NativeConnectionRequestOwner {
  private readonly shutdown = new AbortController()
  /** Installation and explicit shutdown cancellation shared by all admitted callbacks. */
  readonly signal: AbortSignal
  private readonly pending = new Set<Promise<unknown>>()
  private readonly cleanupFailures: unknown[] = []
  private closed = false
  private closing: Promise<void> | undefined

  /**
   * @param lifetime - owning installation cancellation.
   * @param maxPendingRequests - positive safe integer validated by the owning deployment parser.
   */
  constructor(lifetime: AbortSignal, private readonly maxPendingRequests: number) {
    this.signal = AbortSignal.any([lifetime, this.shutdown.signal])
  }

  /** Admit one callback before acquiring its resources.
   * @param requestSignal - actual carrier cancellation.
   * @param operation - callback using the composed request and Consumer lifetimes.
   * @returns callback result after its resources close; admission failure acquires nothing.
   */
  run<T>(requestSignal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new NativeConnectionRequestAdmissionError('closed'))
    if (this.pending.size >= this.maxPendingRequests) return Promise.reject(new NativeConnectionRequestAdmissionError('capacity'))
    const signal = AbortSignal.any([requestSignal, this.signal])
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return operation(signal)
    })
    this.pending.add(pending)
    const settled = (): void => { this.pending.delete(pending) }
    void pending.then(settled, settled)
    return pending
  }

  /** Record an independent resource-close failure from an admitted callback before that callback settles.
   * @param error - actual teardown failure, excluding business rejection and expected cancellation.
   */
  recordCleanupFailure(error: unknown): void { this.cleanupFailures.push(error) }

  /** Close admission, cancel callbacks and await every accepted resource teardown.
   * @returns shared completion; actual cleanup failures aggregate after all callbacks drain.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.shutdown.abort(new Error('native-request-owner: disposed'))
    return this.closing = Promise.allSettled([...this.pending]).then(() => {
      if (this.cleanupFailures.length > 0) throw new AggregateError(this.cleanupFailures,
        'native-request-owner: resource cleanup failed')
    })
  }
}
