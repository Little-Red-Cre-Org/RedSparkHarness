/** Authenticated read-only browser access to Native task schedules. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-connection/native-host'
import type { NativeTaskSchedulerOperations } from '@deepseek-ai/dsh-task-scheduler/native'
import type { NativeScheduleFrame, NativeScheduledJob } from '@deepseek-ai/dsh-client-native-session/schedule-types'

const emptyRequest = z.strictObject({})
const scheduleEndpoints = new Set(['schedules/list'])

function sameJob(left: NativeScheduledJob, right: NativeScheduledJob): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

class NativeScheduleFeed implements AsyncIterator<NativeScheduleFrame> {
  private readonly unsubscribe: () => void
  private jobs: readonly NativeScheduledJob[]
  private readonly queued: NativeScheduleFrame[] = []
  private initial = true
  private changed = false
  private stopped = false
  private wake: (() => void) | undefined
  constructor(private readonly scheduler: NativeTaskSchedulerOperations, private readonly signal: AbortSignal) {
    this.unsubscribe = scheduler.onSchedulesChanged(() => {
      this.changed = true
      this.wake?.()
      this.wake = undefined
    })
    this.jobs = scheduler.listSchedules()
    signal.addEventListener('abort', this.close, { once: true })
    if (signal.aborted) this.close()
  }

  async next(): Promise<IteratorResult<NativeScheduleFrame>> {
    if (this.initial) {
      this.initial = false
      return this.stopped ? { done: true, value: undefined } : { done: false, value: { type: 'baseline', jobs: this.jobs } }
    }
    while (!this.stopped) {
      const queued = this.queued.shift()
      if (queued !== undefined) return { done: false, value: queued }
      if (!this.changed) {
        await new Promise<void>((resolve) => { this.wake = resolve })
        continue
      }
      this.changed = false
      this.queued.push(...this.diff(this.scheduler.listSchedules()))
    }
    return { done: true, value: undefined }
  }

  return(): Promise<IteratorResult<NativeScheduleFrame>> {
    this.close()
    return Promise.resolve({ done: true, value: undefined })
  }

  close = (): void => {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe()
    this.signal.removeEventListener('abort', this.close)
    this.wake?.()
    this.wake = undefined
  }

  private diff(current: readonly NativeScheduledJob[]): NativeScheduleFrame[] {
    const previousById = new Map(this.jobs.map(job => [job.id, job]))
    const currentById = new Map(current.map(job => [job.id, job]))
    const frames: NativeScheduleFrame[] = []
    for (const job of current) {
      const previous = previousById.get(job.id)
      if (previous === undefined || !sameJob(previous, job)) frames.push({ type: 'upsert', job })
    }
    for (const job of this.jobs) if (!currentById.has(job.id)) frames.push({ type: 'remove', id: job.id })
    this.jobs = current
    return frames
  }
}

class NativeScheduleController {
  constructor(private readonly scheduler: NativeTaskSchedulerOperations, private readonly lifetime: AbortSignal) {}

  handle(endpoint: string, payload: unknown, signal: AbortSignal) {
    try {
      if (endpoint !== 'schedules/list') throw new Error('unsupported schedule endpoint')
      emptyRequest.parse(payload)
      signal.throwIfAborted()
      return Promise.resolve({ ok: true as const, value: this.scheduler.listSchedules() })
    } catch {
      signal.throwIfAborted()
      return Promise.resolve({ ok: false as const, error: {
        code: 'native/schedules', message: 'Schedule request failed.', details: {},
      } })
    }
  }

  async follow(request: Request): Promise<Response> {
    try { emptyRequest.parse(await request.json()) }
    catch { return new Response(null, { status: 400 }) }
    const signal = AbortSignal.any([request.signal, this.lifetime])
    const iterator = new NativeScheduleFeed(this.scheduler, signal)
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      },
      cancel() { void iterator.return() },
    }, { highWaterMark: 0 })
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }
}

/** Native Web schedule endpoint Consumer over the existing scheduler and Connection. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-native-schedule-controller',
  targets: ['host'],
  requires: ['hostConnection', 'taskScheduler'],
  optional: [],
  provides: [],
  resolve() {
    return (context) => {
      const controller = new NativeScheduleController(context.require('taskScheduler'), context.signal)
      context.own(context.require('hostConnection').rpc.intercept('/api', endpoint => scheduleEndpoints.has(endpoint),
        (endpoint, payload, signal) => controller.handle(endpoint, payload, signal)))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/schedules/follow', methods: ['POST'],
        requestBody: 'buffered', fetch: request => controller.follow(request) }))
    }
  },
}
