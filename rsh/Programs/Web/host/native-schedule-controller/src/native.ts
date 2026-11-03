/** Authenticated read-only browser access to Native task schedules. */
import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-client-connection/native-host'
import type { NativeTaskSchedulerOperations } from '@redspark/rsh-task-scheduler/native'
import type { NativeScheduleFrame, NativeScheduledJob } from '@redspark/rsh-client-native-session/schedule-types'

const emptyRequest = z.strictObject({})
/** One plan identity for a pause, resume, or delete. */
const scheduleChange = z.strictObject({ id: z.string().min(1) })
const scheduleEndpoints = new Set([
  'schedules/list', 'schedules/pause', 'schedules/resume', 'schedules/delete',
])

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
  constructor(
    private readonly project: () => readonly NativeScheduledJob[],
    private readonly signal: AbortSignal,
    onSchedulesChanged: (listener: () => void) => () => void,
  ) {
    this.unsubscribe = onSchedulesChanged(() => {
      this.changed = true
      this.wake?.()
      this.wake = undefined
    })
    // The feed and the one-shot list must emit the SAME row shape. Projecting
    // again here is what keeps a pushed upsert from arriving without the
    // controllability flag the initial list carried.
    this.jobs = project()
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
      this.queued.push(...this.diff(this.project()))
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

  /**
   * Project one durable view into the browser row.
   *
   * `controllable` is answered from the live owner registry only: changing a
   * plan resolves ownership by Session id, and a Session that is not currently
   * active has no owner, so the change would fail at the last moment. Reporting
   * it up front lets a list hide a control it cannot honour instead of letting
   * the user press it and watch it fail.
   *
   * Nothing here wakes or starts an owner to answer the question — the snapshot
   * is read, never provoked.
   */
  private project(): readonly NativeScheduledJob[] {
    const live = new Set(this.scheduler.liveOwners().map(owner => owner.session.id))
    return this.scheduler.listSchedules().map(view => ({
      ...view,
      controllable: live.has(view.sessionId),
    }))
  }

  handle(endpoint: string, payload: unknown, signal: AbortSignal) {
    try {
      signal.throwIfAborted()
      if (endpoint === 'schedules/list') {
        emptyRequest.parse(payload)
        return Promise.resolve({ ok: true as const, value: this.project() })
      }
      const change = scheduleChange.parse(payload)
      return this.change(endpoint, change.id, signal)
    } catch {
      signal.throwIfAborted()
      return Promise.resolve({ ok: false as const, error: {
        code: 'native/schedules', message: 'Schedule request failed.', details: {},
      } })
    }
  }

  /**
   * Apply one pause/resume/delete through the scheduler's own state machine.
   *
   * The durability rules live in the store (frozen remaining delay on pause,
   * end-window refusal on resume), so this must not re-implement them. It only
   * resolves which active owner may perform the change.
   *
   * Deleting an already-absent plan is reported as success: a second click on a
   * row that is already gone has achieved what the user asked for, and turning
   * that into an error surfaces a scary failure for a no-op.
   */
  private async change(endpoint: string, id: string, signal: AbortSignal) {
    const action = endpoint === 'schedules/pause' ? 'paused'
      : endpoint === 'schedules/resume' ? 'active' : 'deleted'
    const target = this.scheduler.listSchedules().find(view => view.id === id)
    if (target === undefined && action === 'deleted') {
      return { ok: true as const, value: this.project() }
    }
    if (target === undefined) {
      return { ok: false as const, error: {
        code: 'native/schedules', message: 'That scheduled plan no longer exists.', details: {},
      } }
    }
    const owner = this.scheduler.liveOwners().find(candidate => String(candidate.session.id) === String(target.sessionId))
    if (owner === undefined) {
      // The plan belongs to a Session that is not live. Refusing here is the
      // permission boundary: one connection must never change another Session's plan.
      return { ok: false as const, error: {
        code: 'native/schedules', message: 'That plan belongs to a Session that is not open.', details: {},
      } }
    }
    try {
      await this.scheduler.change(owner, id as Parameters<typeof this.scheduler.change>[1], action, signal)
    } catch (error) {
      // A goal plan can only be resumed from inside an explicit human turn, and
      // a resumed window can overrun its end time. Both are real refusals, so
      // the message is surfaced rather than flattened.
      return { ok: false as const, error: {
        code: 'native/schedules',
        message: error instanceof Error ? error.message : 'Schedule request failed.',
        details: {},
      } }
    }
    return { ok: true as const, value: this.project() }
  }

  async follow(request: Request): Promise<Response> {
    try { emptyRequest.parse(await request.json()) }
    catch { return new Response(null, { status: 400 }) }
    const signal = AbortSignal.any([request.signal, this.lifetime])
    const iterator = new NativeScheduleFeed(() => this.project(), signal,
      listener => this.scheduler.onSchedulesChanged(listener))
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
  name: '@redspark/rsh-native-schedule-controller',
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
