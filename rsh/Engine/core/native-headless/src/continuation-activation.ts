/** Resident child turn scheduling around the selected Program driver and durable Session owner. */
import type { NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeSessionTurnResult } from '@deepseek-ai/dsh-native-session-execution'
import type { InboxTarget } from '@deepseek-ai/dsh-native-agent'
import type { NativeContinuationSession } from './continuation-session.ts'

/** One invocation of the existing Program turn driver, using the retained Session writer. */
export interface NativeContinuationDriver {
  /** Close active-owner lookup and drain its Consumers before writer teardown. @returns quiescent Consumer release. */
  closing?(): Promise<void>
  /**
   * Run one ordinary turn; claim durable input through the supplied resident owner.
   * @param owner - the sole Session, writer and pending-input owner.
   * @param initial - whether this is the first turn of a fresh child.
   * @param signal - current-turn cancellation independent of pending input.
   * @returns the shared driver's settled turn result.
   */
  run(owner: NativeContinuationSession, initial: boolean, signal: AbortSignal): Promise<NativeSessionTurnResult>
  /** Release Program-owned composition and Agent registration after the writer closes. @returns quiescent resource release. */
  release(): Promise<void>
  /**
   * Publish one natural-settlement outcome after writer and Agent release.
   * @param result - last turn result, or undefined when admission never ran a turn.
   * @param failure - independent execution or cleanup failure, when present.
   * @returns completion of any durable notification admission.
   */
  settled(result: NativeSessionTurnResult | undefined, failure: unknown): Promise<void>
}

/** Existing Agent execution drives all accepted work; the durable inbox is the only message queue. */
export class NativeContinuationActivation {
  private readonly closed = Promise.withResolvers<void>()
  private changed = Promise.withResolvers<undefined>()
  private turn: AbortController | undefined
  private turnSettled: Promise<void> | undefined
  private pumping: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private children = 0
  private backgroundTasks = 0
  private initial: boolean
  private result: NativeSessionTurnResult | undefined
  private failure: { readonly error: unknown } | undefined
  private parked = false

  /**
   * @param owner - retained Program-owned Session and exclusive writer.
   * @param execution - the exact registered Agent's unique execution owner.
   * @param driver - callbacks to the existing turn driver and Program cleanup.
   * @param fresh - whether initial-turn preparation still applies.
   */
  constructor(readonly owner: NativeContinuationSession, private readonly execution: NativeAgentExecution,
    private readonly driver: NativeContinuationDriver, fresh: boolean) {
    this.initial = fresh
    void this.closed.promise.catch((error: unknown) => { this.failure ??= { error } })
  }

  /** Completion after natural or explicit release, including notification failure. */
  get done(): Promise<void> { return this.closed.promise }

  /** Last ordinary turn result; final after done resolves and retained ownership has released. */
  get lastResult(): NativeSessionTurnResult | undefined { return this.result }

  /** Whether this residency epoch has stopped admitting messages or owned descendants. */
  get isClosing(): boolean { return this.closing !== undefined }

  /** Whether admitted descendants or retained work still hold residency. */
  get isRetained(): boolean { return this.children > 0 || this.backgroundTasks > 0 }

  /**
   * Durably accept one message and wake the selected ordinary turn driver.
   * @param message - identified validated input.
   * @param target - queue a turn or steer the next step.
   * @param signal - cancellation before durable admission begins.
   * @returns the accepted input id, independently of its eventual turn outcome.
   */
  async enqueue(message: UserMessage, target: InboxTarget, signal: AbortSignal): Promise<MessageId> {
    if (this.closing !== undefined) throw new Error('native-continuation: Activation is closing')
    const id = await this.owner.enqueue(message, target, signal)
    this.parked = false
    this.wake()
    return id
  }

  /**
   * Prevent natural settlement while an admitted descendant still owns work.
   * @returns exact idempotent release; releasing the final descendant rechecks pending input.
   */
  retainChild(): () => void {
    if (this.closing !== undefined) throw new Error('native-continuation: Activation is closing')
    this.children += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.children -= 1
      this.wake()
    }
  }

  /** Retain root background work without blocking its ordinary foreground result. */
  retainBackground(): () => void {
    if (this.closing !== undefined) throw new Error('native-continuation: Activation is closing')
    this.backgroundTasks += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.backgroundTasks -= 1
      this.wake()
    }
  }

  /** Wait for foreground turns while allowing background-only root work to continue. */
  async waitForeground(): Promise<void> {
    while (true) {
      if (this.closing !== undefined) { await this.done; return }
      if (this.turn === undefined && !this.owner.hasPending && this.children === 0) {
        if (this.backgroundTasks > 0) return
        await this.done
        return
      }
      await this.changed.promise
    }
  }

  /**
   * Interrupt only the current turn; unclaimed input stays parked until another message wakes it.
   * @param reason - cancellation cause for the selected driver.
   * @returns completion after the current turn cleanup and durable closer.
   */
  interrupt(reason: unknown): Promise<void> {
    if (this.turn === undefined) return Promise.resolve()
    this.parked = true
    if (!this.turn.signal.aborted) this.turn.abort(reason)
    return this.turnSettled ?? Promise.resolve()
  }

  /** Close admission, interrupt active work and drain before releasing the writer. @returns the memoized release transaction. */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const completion = Promise.withResolvers<void>()
    this.closing = completion.promise
    this.turn?.abort({ kind: 'parent' })
    this.changed.resolve(undefined)
    void this.closeInternal().then(completion.resolve, completion.reject)
    return completion.promise
  }

  private wake(): void {
    this.changed.resolve(undefined)
    this.changed = Promise.withResolvers<undefined>()
    if (this.closing !== undefined || this.pumping !== undefined) return
    const completion = Promise.withResolvers<void>()
    this.pumping = completion.promise
    void this.pump().then(completion.resolve, completion.reject)
    void completion.promise.then(() => {
      this.pumping = undefined
      if (this.closing !== undefined) return
      if (this.owner.hasPending || this.children > 0 || this.backgroundTasks > 0) this.wake()
      else void this.close().catch((error: unknown) => { this.failure ??= { error } })
    }, (error: unknown) => {
      this.pumping = undefined
      this.failure = { error }
      void this.close().catch((error: unknown) => { this.failure ??= { error } })
    })
  }

  private async pump(): Promise<void> {
    while (this.closing === undefined) {
      const changed = this.changed.promise
      if (!this.owner.hasPending) {
        if (this.children === 0 && this.backgroundTasks === 0) return
        await changed
        continue
      }
      if (this.parked) {
        await changed
        continue
      }
      const controller = new AbortController()
      this.turn = controller
      const settled = Promise.withResolvers<void>()
      this.turnSettled = settled.promise
      const initial = this.initial
      this.initial = false
      let executionSignal: AbortSignal | undefined
      try {
        this.result = await this.execution.run((signal) => {
          executionSignal = signal
          return this.driver.run(this.owner, initial, signal)
        }, controller.signal)
      } catch (error: unknown) {
        // Abortable Node APIs wrap the exact signal reason in AbortError.cause.
        const expectedAbort = [controller.signal, executionSignal, this.execution.signal].some(signal => signal?.aborted
          && (error === signal.reason || error instanceof Error && error.name === 'AbortError' && error.cause === signal.reason))
        if (!expectedAbort) throw error
        this.result = { exitCode: 1 }
      } finally {
        if (this.turn === controller) this.turn = undefined
        if (this.turnSettled === settled.promise) this.turnSettled = undefined
        settled.resolve()
      }
      this.wake()
    }
  }

  private async closeInternal(): Promise<void> {
    const failures: unknown[] = this.failure === undefined ? [] : [this.failure.error]
    const pump = this.pumping
    if (pump !== undefined) {
      try { await pump } catch (error: unknown) { if (!failures.includes(error)) failures.push(error) }
    }
    for (const release of [() => this.driver.closing?.(), () => this.owner.discard(),
      () => this.owner.close(), () => this.driver.release()]) {
      try { await release() } catch (error: unknown) { failures.push(error) }
    }
    const failure = failures.length === 0 ? undefined : failures.length === 1 ? failures[0]
      : new AggregateError(failures, 'native-continuation: execution and cleanup failed')
    try { await this.driver.settled(this.result, failure) } catch (error: unknown) { failures.push(error) }
    if (failures.length === 0) this.closed.resolve()
    else {
      const error = failures.length === 1 ? failures[0] : new AggregateError(failures, 'native-continuation: settlement failed')
      this.closed.reject(error)
      throw error
    }
  }
}
