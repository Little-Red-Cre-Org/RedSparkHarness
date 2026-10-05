/** Native conversation view state; Session execution and persistence remain on the Host. */
import type { NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'

/** Settled durable history and the Client's outstanding operation. */
export interface ConversationSnapshot {
  readonly sessions: readonly SessionHeader[]
  readonly selected?: SessionId
  readonly events: readonly SessionEvent[]
  readonly state: 'loading' | 'ready' | 'sending' | 'cancelling' | 'closed'
  readonly error?: string | undefined
}

/** Own one interactive Session selection and await all requests before disposal. */
export class NativeConversationController {
  private snapshot: ConversationSnapshot = { sessions: [], events: [], state: 'loading' }
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<void>>()
  private turn: AbortController | undefined
  private closing: Promise<void> | undefined

  /** @param client - selected Host Session Consumer; this controller does not close the shared Provider. */
  constructor(private readonly client: NativeSessionClient) {}

  /** Read the current conversation view.
   * @returns immutable view snapshot, stable until an operation publishes a change. */
  readonly getSnapshot = (): ConversationSnapshot => this.snapshot

  /** Observe view changes.
   * @param listener - render notification.
   * @returns exact notification removal.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(change: Partial<ConversationSnapshot>): void {
    if (this.lifetime.signal.aborted) return
    this.snapshot = Object.freeze({ ...this.snapshot, ...change })
    for (const listener of [...this.listeners]) {
      try { listener() } catch (error: unknown) { console.error('native conversation subscriber failed:', error) }
    }
  }

  private run(operation: () => Promise<void>): Promise<void> {
    this.lifetime.signal.throwIfAborted()
    const pending = operation().catch((error: unknown) => {
      this.publish({ error: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      this.pending.delete(pending)
      this.publish({ state: 'ready' })
    })
    this.pending.add(pending)
    return pending
  }

  private assertReady(): void {
    if (this.snapshot.state !== 'ready') throw new Error('native conversation: operation already pending')
  }

  private async restore(id: SessionId): Promise<void> {
    const history = await this.client.history(id, this.lifetime.signal)
    this.publish({ selected: id, events: history.events })
  }

  /** Read the persisted index without automatically resuming a Session.
   * @returns completion after the initial index request.
   */
  load(): Promise<void> {
    return this.run(async () => {
      this.publish({ sessions: await this.client.list(this.lifetime.signal), error: undefined })
    })
  }

  /** Create and select a durably stored blank Session.
   * @returns completion after its header and history are available.
   */
  create(): Promise<void> {
    this.assertReady()
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      const { sessionId } = await this.client.create(this.lifetime.signal)
      await this.restore(sessionId)
      this.publish({ sessions: await this.client.list(this.lifetime.signal) })
    })
  }

  /** Select a stored Session and reconstruct its durable transcript.
   * @param id - identity from the Host's index.
   * @returns history completion; selection does not execute a turn.
   */
  select(id: SessionId): Promise<void> {
    this.assertReady()
    this.publish({ state: 'loading', error: undefined })
    return this.run(() => this.restore(id))
  }

  /** Send human text through the Host's sole turn executor.
   * @param text - nonempty submitted text.
   * @returns completion after Host settlement and durable transcript refresh.
   */
  send(text: string): Promise<void> {
    this.assertReady()
    const id = this.snapshot.selected
    if (id === undefined || text.trim().length === 0) throw new Error('native conversation: select a Session and enter text')
    const turn = new AbortController()
    this.turn = turn
    this.publish({ state: 'sending', error: undefined })
    return this.run(async () => {
      try {
        const result = await this.client.prompt(id, text, true, AbortSignal.any([turn.signal, this.lifetime.signal]))
        if (result.exitCode !== 0 && result.exitCode !== 130) {
          throw new Error(`native conversation: turn exited with code ${result.exitCode}`)
        }
      } finally {
        this.turn = undefined
        if (!this.lifetime.signal.aborted) await this.restore(id)
      }
    })
  }

  /** Request cancellation; readiness is published only by the settled send operation. */
  cancel(): void {
    if (this.turn === undefined) return
    this.publish({ state: 'cancelling' })
    this.turn.abort(new Error('native conversation: user cancelled'))
  }

  /** Cancel owned calls and await the Client's durable prompt settlement.
   * @returns memoized disposal completion.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.lifetime.abort(new Error('native conversation: disposed'))
    this.snapshot = Object.freeze({ ...this.snapshot, state: 'closed' })
    this.listeners.clear()
    return this.closing = Promise.allSettled([...this.pending]).then(() => undefined)
  }
}
