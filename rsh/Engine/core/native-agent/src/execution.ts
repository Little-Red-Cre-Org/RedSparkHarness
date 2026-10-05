/** Per-Agent FIFO execution and exclusive idle maintenance without Session ownership. */
import type { NativeAgent, NativeAgentRegistry } from './index.ts'

/** Observable execution admission state for one persistent Agent. */
export type NativeAgentExecutionStatus = 'idle' | 'running' | 'maintenance' | 'closing' | 'disposed'

interface PendingOperation {
  readonly kind: 'running' | 'maintenance'
  readonly signal: AbortSignal | undefined
  readonly onAbort: () => void
  run(signal: AbortSignal): Promise<() => void>
  reject(reason: unknown): void
}

/**
 * Serializes operations for one registered identity. Disposal cancels queued work
 * and awaits the active body; registration and durable Session writes remain owned
 * by the caller. An operation must not await disposal of its own execution owner.
 */
export class NativeAgentExecution {
  private readonly queue: PendingOperation[] = []
  private readonly cancellation = new AbortController()
  private active: PendingOperation | undefined
  private closing = false
  private disposed = false
  private readonly drained = Promise.withResolvers<void>()
  private readonly releaseCleanup: () => void
  private readonly lifetime: AbortSignal | undefined
  private readonly onLifetimeAbort = (): void => { void this.dispose() }

  /**
   * @param agents - registry owning the exact Agent and its initiator attribution.
   * @param agent - registered identity retained across operations.
   * @param lifetime - optional host cancellation; closes admission before draining.
   */
  constructor(private readonly agents: NativeAgentRegistry, readonly agent: NativeAgent, lifetime?: AbortSignal) {
    this.releaseCleanup = agents.onDispose(agent, () => this.dispose())
    this.lifetime = lifetime
    if (lifetime?.aborted) void this.dispose()
    else lifetime?.addEventListener('abort', this.onLifetimeAbort, { once: true })
  }

  /** Current admission and execution state; an active cancelled body remains closing until it exits. */
  get status(): NativeAgentExecutionStatus {
    if (this.disposed) return 'disposed'
    if (this.closing) return 'closing'
    return this.active?.kind ?? 'idle'
  }

  /** Agent execution lifetime; aborts when disposal starts, independently of any current model turn. */
  get signal(): AbortSignal { return this.cancellation.signal }

  /**
   * Queue one operation in admission order, preserving its result or rejection.
   * @param task - body executed with this Agent as initiator and composed cancellation.
   * @param signal - caller cancellation, including while the operation is queued.
   * @returns the body result after it exits; cancelled queued bodies never start.
   */
  run<T>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertAccepting()
    return this.enqueue('running', task, signal)
  }

  /**
   * Reserve idle execution synchronously; later turns queue behind this maintenance.
   * @param task - exclusive maintenance with Agent-owned cancellation.
   * @returns the preserved maintenance result after the body exits.
   * @throws synchronously when another operation is active or already queued.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertAccepting()
    if (this.active !== undefined || this.queue.length !== 0) throw new Error('native-agent: Agent is busy')
    return this.enqueue('maintenance', task, undefined)
  }

  /**
   * Close admission, cancel pending work and wait for the active body to exit.
   * @returns the same quiescent disposal promise on every call.
   */
  dispose(): Promise<void> {
    if (!this.closing) {
      this.closing = true
      this.cancellation.abort({ kind: 'disposed' })
      for (const operation of this.queue.splice(0)) {
        operation.signal?.removeEventListener('abort', operation.onAbort)
        operation.reject(this.cancellation.signal.reason)
      }
      this.finishDisposal()
    }
    return this.drained.promise
  }

  private enqueue<T>(kind: PendingOperation['kind'], task: (signal: AbortSignal) => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    // Preserve the caller's exact cancellation reason, including non-Error reasons.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    if (signal?.aborted) return Promise.reject(signal.reason)
    const result = Promise.withResolvers<T>()
    const operation: PendingOperation = {
      kind, signal,
      onAbort: () => {
        const index = this.queue.indexOf(operation)
        if (index === -1) return
        this.queue.splice(index, 1)
        signal?.removeEventListener('abort', operation.onAbort)
        result.reject(signal?.reason)
      },
      run: async (composed) => {
        const value = await task(composed)
        return () => { result.resolve(value) }
      },
      reject: result.reject,
    }
    this.queue.push(operation)
    signal?.addEventListener('abort', operation.onAbort, { once: true })
    this.startNext()
    return result.promise
  }

  private startNext(): void {
    if (this.closing || this.active !== undefined) return
    const operation = this.queue.shift()
    if (operation === undefined) return
    operation.signal?.removeEventListener('abort', operation.onAbort)
    this.active = operation
    void this.perform(operation)
  }

  private async perform(operation: PendingOperation): Promise<void> {
    const signal = operation.signal === undefined ? this.cancellation.signal
      : AbortSignal.any([this.cancellation.signal, operation.signal])
    let settle: () => void
    try {
      signal.throwIfAborted()
      settle = await this.agents.withInitiator(this.agent, () => operation.run(signal))
    } catch (error: unknown) {
      settle = () => { operation.reject(error) }
    }
    this.active = undefined
    settle()
    if (this.closing) this.finishDisposal()
    else this.startNext()
  }

  private finishDisposal(): void {
    if (this.active !== undefined || this.disposed) return
    this.disposed = true
    this.lifetime?.removeEventListener('abort', this.onLifetimeAbort)
    this.releaseCleanup()
    this.drained.resolve()
  }

  private assertAccepting(): void {
    if (this.closing || this.agents.get(this.agent.id) !== this.agent) throw new Error('native-agent: Agent execution is disposed')
  }
}
