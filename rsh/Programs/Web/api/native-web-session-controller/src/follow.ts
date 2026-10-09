/** Bounded, admission-owned SSE presentation; the Program retains execution ownership. */
import type { NativeSessionFollowFrame } from '@deepseek-ai/dsh-client-native-session/follow-types'

/** One turn's ordered output, retained only until its exact follower reads or detaches. */
export class NativeSessionFeed {
  private readonly frames: Uint8Array[] = []
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
    const bytes = this.encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
    if (this.bytes + bytes.byteLength > this.maxBytes) {
      this.error = new Error('native Session follow: unread output exceeds configured byte limit')
      this.overflow(this.error)
    } else {
      this.frames.push(bytes)
      this.bytes += bytes.byteLength
    }
    this.wake?.()
  }

  /** End only after execution and writer settlement. */
  finish(): void {
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
        while (!closed && this.frames.length === 0 && !this.ended && this.error === undefined) {
          await new Promise<void>((resolve) => { this.wake = resolve })
          this.wake = undefined
        }
        if (closed) { controller.close(); return }
        if (this.error !== undefined) { const error = this.error; detach(); controller.error(error); return }
        const bytes = this.frames.shift()
        if (bytes !== undefined) { this.bytes -= bytes.byteLength; controller.enqueue(bytes); return }
        detach()
        controller.close()
      },
      cancel: () => { detach() },
    }, { highWaterMark: 0 })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }
}
