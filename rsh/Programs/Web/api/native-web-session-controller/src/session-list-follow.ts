/** Authenticated SSE transport for Native Session-list invalidations. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/list-types'

class SessionListChangeQueue implements AsyncIterator<SessionId> {
  private readonly values: SessionId[] = []
  private readonly queued = new Set<SessionId>()
  private waiter: ((result: IteratorResult<SessionId>) => void) | undefined
  private closed = false

  next(): Promise<IteratorResult<SessionId>> {
    const value = this.values.shift()
    if (value !== undefined) {
      this.queued.delete(value)
      return Promise.resolve({ done: false, value })
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => { this.waiter = resolve })
  }

  push(sessionId: SessionId): void {
    if (this.closed || this.queued.has(sessionId)) return
    const waiter = this.waiter
    if (waiter !== undefined) {
      this.waiter = undefined
      waiter({ done: false, value: sessionId })
    } else {
      this.queued.add(sessionId)
      this.values.push(sessionId)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.values.length = 0
    this.queued.clear()
    this.waiter?.({ done: true, value: undefined })
    this.waiter = undefined
  }
}

/** One list follower receives its baseline before coalesced Session changes. */
export class NativeSessionListFeed {
  private readonly changes = new SessionListChangeQueue()
  private stop: (() => void) | undefined

  /** @param release - remove this feed and release its follower slot exactly once. */
  constructor(private readonly release: () => void) {}

  /** @param sessionId - Session whose list projection changed. */
  push(sessionId: SessionId): void { this.changes.push(sessionId) }

  /** Close the stream when the Host service is disposed. */
  close(): void {
    if (this.stop === undefined) this.changes.close()
    else this.stop()
  }

  /**
   * @param signal - caller and Host lifetime cancellation.
   * @param baseline - current ordered Session list.
   * @param project - current item, or undefined when the Session is absent.
   * @returns a backpressured SSE response.
   */
  response(signal: AbortSignal, baseline: () => Promise<readonly NativeSessionListItem[]>,
    project: (sessionId: SessionId) => Promise<NativeSessionListItem | undefined>): Response {
    const state = { closed: false, sentBaseline: false }
    const encoder = new TextEncoder()
    const changes = this.changes
    const stop = (): void => {
      if (state.closed) return
      state.closed = true
      changes.close()
      signal.removeEventListener('abort', stop)
      this.stop = undefined
      this.release()
    }
    const isClosed = (): boolean => state.closed
    this.stop = stop
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (isClosed()) { controller.close(); return }
        try {
          if (!state.sentBaseline) {
            state.sentBaseline = true
            const frame = { type: 'baseline', items: await baseline() } as const
            if (isClosed()) controller.close()
            else controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
            return
          }
          const next = await changes.next()
          if (next.done) { stop(); controller.close(); return }
          const item = await project(next.value)
          const frame = item === undefined
            ? { type: 'remove', sessionId: next.value } as const
            : { type: 'upsert', item } as const
          if (isClosed()) controller.close()
          else controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        } catch (error: unknown) {
          stop()
          controller.error(error)
        }
      },
      cancel() { stop() },
    }, { highWaterMark: 0 })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }
}
