/** Secret-free settings invalidations streamed to the authenticated browser. */
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-settings-definition/native'
import type {} from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-llm-pi-ai/native'
import { z } from 'zod'

const requestSchema = z.strictObject({})

/** One settings-page invalidation; values remain in their owning RPCs. */
export type NativeSettingsEvent =
  | { readonly type: 'settings/document-updated'; readonly namespace: string; readonly revision: number }
  | { readonly type: 'credentials/reference-updated'; readonly ref: string }
  | { readonly type: 'llm/adapters-updated' }
  | { readonly type: 'accounts/changed'; readonly key: string }

function subject(event: NativeSettingsEvent): string {
  if (event.type === 'settings/document-updated') return `${event.type}:${event.namespace}`
  if (event.type === 'credentials/reference-updated') return `${event.type}:${event.ref}`
  if (event.type === 'accounts/changed') return `${event.type}:${event.key}`
  return event.type
}

class EventQueue implements AsyncIterator<NativeSettingsEvent> {
  private readonly values: NativeSettingsEvent[] = []
  private waiter: ((result: IteratorResult<NativeSettingsEvent>) => void) | undefined
  private closed = false

  next(): Promise<IteratorResult<NativeSettingsEvent>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => { this.waiter = resolve })
  }

  push(value: NativeSettingsEvent): void {
    if (this.closed) return
    const waiter = this.waiter
    if (waiter === undefined) {
      // Coalesce by subject so a stalled reader holds at most one frame per namespace, reference or adapter set.
      const index = this.values.findIndex(queued => subject(queued) === subject(value))
      if (index === -1) this.values.push(value)
      else this.values[index] = value
    } else {
      this.waiter = undefined
      waiter({ done: false, value })
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.values.length = 0
    this.waiter?.({ done: true, value: undefined })
    this.waiter = undefined
  }
}

/** Publish Native settings invalidations as one authenticated SSE stream. */
export class NativeWebSettingsEvents {
  private readonly queues = new Map<EventQueue, () => void>()
  private readonly unsubscribe: (() => Promise<void>)[]

  /**
   * @param context - Native event subscriptions and Host lifetime.
   */
  constructor(private readonly context: Pick<NativeContext, 'on' | 'signal'>) {
    this.unsubscribe = [
      context.on('settings/document-updated', (namespace, revision) => {
        this.publish({ type: 'settings/document-updated', namespace, revision })
      }),
      context.on('credentials/reference-updated', (ref) => {
        this.publish({ type: 'credentials/reference-updated', ref })
      }),
      context.on('llm/adapters-updated', () => { this.publish({ type: 'llm/adapters-updated' }) }),
      context.on('accounts/changed', (key) => { this.publish({ type: 'accounts/changed', key }) }),
    ]
  }

  /**
   * Stream current settings invalidations until the browser request or Host ends.
   * @param request - authenticated empty POST request.
   * @returns an SSE stream containing notification frames only.
   */
  async stream(request: Request): Promise<Response> {
    requestSchema.parse(await request.json())
    const queue = new EventQueue()
    const signal = AbortSignal.any([request.signal, this.context.signal])
    const stop = (): void => {
      queue.close()
      this.queues.delete(queue)
      signal.removeEventListener('abort', stop)
    }
    this.queues.set(queue, stop)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const iterator = queue
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) {
          stop()
          controller.close()
        } else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      },
      cancel() { stop() },
    }, { highWaterMark: 0 })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }

  /** Stop event subscriptions and finish every open browser stream. @returns completion of admitted listener cleanup. */
  async close(): Promise<void> {
    for (const stop of this.queues.values()) stop()
    await Promise.all(this.unsubscribe.map(unsubscribe => unsubscribe()))
  }

  private publish(event: NativeSettingsEvent): void {
    for (const queue of this.queues.keys()) queue.push(event)
  }
}
