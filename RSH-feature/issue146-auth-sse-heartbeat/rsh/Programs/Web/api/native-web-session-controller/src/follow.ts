/** Bounded, admission-owned SSE presentation; the Program retains execution ownership. */
import type { NativeSessionFollowFrame } from '@deepseek-ai/dsh-client-native-session/follow-types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

/** One turn's ordered output, retained only until its exact follower reads or detaches. */
export class NativeSessionFeed {
  private readonly frames: { readonly bytes: Uint8Array; readonly eventSeq?: number }[] = []
  private readonly baselineEvents: Uint8Array[] = []
  private baseline: Uint8Array | undefined
  private baselineSet = false
  private baselineSent = false
  private baselineTail: number | undefined
  private bytes = 0
  private ended = false
  private detached = false
  private wake: (() => void) | undefined
  private error: Error | undefined
  private readonly encoder = new TextEncoder()

  /**
   * @param maxBytes - maximum unread serialized output, including SSE framing.
   * @param overflow - cancels the owning turn; its settlement still drains the writer.
   */
  constructor(private readonly maxBytes: number, private readonly overflow: (error: Error) => void) {}

  /**
   * @param frame - accepted durable event or transient model text.
   */
  push(frame: NativeSessionFollowFrame): void {
    if (this.detached || this.ended || this.error !== undefined) return
    if (frame.type === 'event' && this.baselineTail !== undefined && frame.event.seq <= this.baselineTail) return
    const bytes = this.encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
    if (this.bytes + bytes.byteLength > this.maxBytes) {
      this.error = new Error('native Session follow: unread output exceeds configured byte limit')
      this.overflow(this.error)
    } else {
      this.frames.push({ bytes, ...frame.type === 'event' ? { eventSeq: frame.event.seq } : {} })
      this.bytes += bytes.byteLength
    }
    this.wake?.()
  }

  /** Set the exact owner cursor before releasing missing history and buffered live events.
   * @param sessionId - Session selected by this admission.
   * @param fromSeq - Last event already applied by the Client before admission.
   * @param events - Contiguous durable events after that cursor.
   */
  setBaseline(sessionId: SessionId, fromSeq: number, events: readonly SessionEvent[]): void {
    if (this.baselineSet || this.ended || this.error !== undefined) throw this.error ?? new Error('native Session follow: baseline is unavailable')
    this.baselineSet = true
    const throughSeq = events.at(-1)?.seq ?? fromSeq
    if (!Number.isSafeInteger(fromSeq) || fromSeq < -1 || !Number.isSafeInteger(throughSeq) || throughSeq < fromSeq
      || events.length !== throughSeq - fromSeq) throw new Error('native Session follow: invalid baseline range')
    for (let index = 0; index < events.length; index += 1) {
      if (events[index]?.seq !== fromSeq + index + 1) throw new Error('native Session follow: baseline events are not contiguous')
    }
    this.baselineTail = throughSeq
    const retained: typeof this.frames = []
    for (const queued of this.frames) {
      if (queued.eventSeq !== undefined && queued.eventSeq <= throughSeq) this.bytes -= queued.bytes.byteLength
      else retained.push(queued)
    }
    this.frames.length = 0
    for (const queued of retained) this.frames.push(queued)
    if (this.detached) return
    const frame: Extract<NativeSessionFollowFrame, { type: 'baseline' }> = { type: 'baseline', sessionId, fromSeq, throughSeq }
    const bytes = this.encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
    const encodedEvents = events.map(event => this.encoder.encode(`data: ${JSON.stringify({ type: 'event', event })}\n\n`))
    const baselineBytes = bytes.byteLength + encodedEvents.reduce((sum, event) => sum + event.byteLength, 0)
    if (this.bytes + baselineBytes > this.maxBytes) {
      const error = new Error('native Session follow: unread output exceeds configured byte limit')
      this.fail(error)
      this.overflow(error)
      return
    }
    this.baseline = bytes
    for (const encodedEvent of encodedEvents) this.baselineEvents.push(encodedEvent)
    this.bytes += baselineBytes
    this.wake?.()
  }

  /** End only after execution and writer settlement. */
  finish(): void {
    if (!this.baselineSet && !this.detached && this.error === undefined) {
      this.error = new Error('native Session follow: admission ended before history baseline')
    }
    this.push({ type: 'settled' })
    this.ended = true
    this.wake?.()
  }

  /**
   * @returns overflow failure, checked after the Program has settled.
   */
  failure(): Error | undefined { return this.error }

  /** Surface a late owner-drain failure to an already attached follower. */
  fail(error: Error): void {
    if (this.detached || this.ended || this.error !== undefined) return
    this.error = error
    this.wake?.()
  }

  /**
   * @param signal - exact authenticated follower cancellation.
   * @param release - releases the Host's follower admission once, including natural EOF.
   * @returns backpressured SSE response.
   */
  response(signal: AbortSignal, release: () => void): Response {
    let closed = false
    const detach = (): void => {
      if (closed) return
      closed = true
      this.detached = true
      this.frames.length = 0
      this.baselineEvents.length = 0
      this.baseline = undefined
      this.bytes = 0
      signal.removeEventListener('abort', abort)
      this.wake?.()
      release()
    }
    const abort = (): void => { detach() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) detach()
    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (!closed && (
          !this.baselineSet && this.error === undefined
          || this.baselineSent && this.baselineEvents.length === 0 && this.frames.length === 0 && !this.ended && this.error === undefined
        )) {
          await new Promise<void>((resolve) => { this.wake = resolve })
          this.wake = undefined
        }
        if (closed) { controller.close(); return }
        if (this.error !== undefined) { const error = this.error; detach(); controller.error(error); return }
        if (!this.baselineSent && this.baseline !== undefined) {
          this.baselineSent = true
          this.bytes -= this.baseline.byteLength
          const baseline = this.baseline
          this.baseline = undefined
          controller.enqueue(baseline)
          return
        }
        const baselineEvent = this.baselineEvents.shift()
        if (baselineEvent !== undefined) { this.bytes -= baselineEvent.byteLength; controller.enqueue(baselineEvent); return }
        const frame = this.frames.shift()
        if (frame !== undefined) { this.bytes -= frame.bytes.byteLength; controller.enqueue(frame.bytes); return }
        detach()
        controller.close()
      },
      cancel: () => { detach() },
    }, { highWaterMark: 0 })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }
}
