/** Authenticated Native schedule RPC, change endpoints, and change frames over the existing Host services. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeScheduleFrame, NativeScheduledJob } from '@redspark/rsh-client-native-session/schedule-types'
import { plugin as scheduleController } from '../src/native.ts'

type Jobs = readonly NativeScheduledJob[]

/** One durable row plus whether its owning Session is treated as live. */
function row(overrides: Partial<NativeScheduledJob> = {}): NativeScheduledJob {
  return {
    id: 'first', sessionId: 'owner' as NativeScheduledJob['sessionId'], title: 'First', state: 'active',
    schedule: '2026-10-11T12:00:00+08:00', timeZone: 'UTC+08:00', nextRunAt: 1791691200000, controllable: true,
    ...overrides,
  }
}

/**
 * Boot the controller over a scheduler stand-in and hand back the installed
 * routes plus the recorded scheduler calls.
 *
 * The stand-in mirrors the real contract: `change` needs an exact owner, so an
 * unknown Session cannot be acted on. That is what the permission tests lean on.
 */
async function boot(options: {
  readonly jobs: () => Jobs
  readonly liveSessions?: readonly string[]
  readonly change?: (id: string, state: string) => void
}) {
  const scope = new NativeScope()
  const listeners = new Set<() => void>()
  const calls: { id: string; state: string }[] = []
  const liveSessions = new Set(options.liveSessions ?? ['owner'])
  const scheduler = {
    listSchedules: () => options.jobs(),
    liveOwners: () => [...liveSessions].map(id => ({ session: { id } })),
    onSchedulesChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async change(owner: { session: { id: string } }, id: string, state: string) {
      calls.push({ id, state })
      options.change?.(id, state)
      // The real store refuses a plan that is not owned by the acting Session.
      if (!liveSessions.has(owner.session.id)) throw new Error('task not found in this session')
      return {}
    },
  }
  let dispatch: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let fetchSchedule: ((request: Request) => Promise<Response>) | undefined
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'schedule-test-connection', targets: ['host'], requires: [], provides: ['hostConnection'],
    resolve: () => (context) => { context.provide('hostConnection', {
      rpc: { intercept: (_channel: string, accepts: (endpoint: string) => boolean, handle: unknown) => {
        if (['schedules/list', 'schedules/pause', 'schedules/resume', 'schedules/delete'].some(accepts)) {
          dispatch = handle as typeof dispatch
        }
        return () => { dispatch = undefined }
      } },
      fetch: { register: (route: { readonly path: string; readonly fetch: (request: Request) => Promise<Response> }) => {
        if (route.path === '/api/schedules/follow') fetchSchedule = route.fetch
        return () => { fetchSchedule = undefined }
      } },
    } as never) },
  }
  const schedulerProvider: NativePlugin = {
    apiVersion: 1, name: 'schedule-test-provider', targets: ['host'], requires: [], provides: ['taskScheduler'],
    resolve: () => (context) => { context.provide('taskScheduler', scheduler as never) },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: carrier, scope, config: undefined },
    { plugin: schedulerProvider, scope, config: undefined },
    { plugin: scheduleController, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (dispatch === undefined || fetchSchedule === undefined) throw new Error('Native schedule routes were not installed')
  // Bound to locals so the narrowing survives the object literal instead of
  // being re-asserted at the property.
  const installedDispatch = dispatch
  const installedFetch = fetchSchedule
  return {
    host,
    calls,
    listeners,
    dispatch: installedDispatch,
    fetchSchedule: installedFetch,
  }
}

const signal = (): AbortSignal => new AbortController().signal

it('lists projected rows and follows baseline, upsert, and remove frames', async () => {
  let jobs: Jobs = [row()]
  const runtime = await boot({ jobs: () => jobs })
  try {
    // The list answers with PROJECTED rows: controllability is added per row.
    expect(await runtime.dispatch('schedules/list', {}, signal())).toEqual({ ok: true, value: jobs })
    expect(await runtime.dispatch('schedules/list', { prompt: 'not accepted' }, signal())).toMatchObject({
      ok: false, error: { code: 'native/schedules', message: 'Schedule request failed.', details: {} },
    })

    const abort = new AbortController()
    const response = await runtime.fetchSchedule(new Request('http://host/api/schedules/follow', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: abort.signal,
    }))
    const reader = response.body!.getReader()
    const decode = (chunk: Uint8Array): NativeScheduleFrame =>
      JSON.parse(new TextDecoder().decode(chunk).replace(/^data: /u, '').trim()) as NativeScheduleFrame
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(decode((await reader.read()).value!)).toEqual({ type: 'baseline', jobs })

    const updated = { ...jobs[0]!, title: 'Updated' }
    const upsertRead = reader.read()
    jobs = [updated]
    for (const listener of runtime.listeners) listener()
    expect(decode((await upsertRead).value!)).toEqual({ type: 'upsert', job: updated })

    const removeRead = reader.read()
    jobs = []
    for (const listener of runtime.listeners) listener()
    expect(decode((await removeRead).value!)).toEqual({ type: 'remove', id: 'first' })
    abort.abort()
    expect(await reader.read()).toMatchObject({ done: true })
  } finally {
    await runtime.host.stop()
  }
})

it('marks a plan controllable only while its Session is live', async () => {
  const runtime = await boot({ jobs: () => [row()], liveSessions: [] })
  try {
    const listed = await runtime.dispatch('schedules/list', {}, signal()) as { value: readonly NativeScheduledJob[] }
    // A closed Session owns no live owner, so the Host reports the plan as not
    // controllable instead of letting a button fail later.
    expect(listed.value.map(job => job.controllable)).toEqual([false])
  } finally {
    await runtime.host.stop()
  }
})

it('pauses through the scheduler and answers with the new projection', async () => {
  let jobs: Jobs = [row()]
  const runtime = await boot({
    jobs: () => jobs,
    change: (id) => { jobs = [row({ id, state: 'paused' })] },
  })
  try {
    const result = await runtime.dispatch('schedules/pause', { id: 'first' }, signal()) as
      { ok: boolean; value: readonly NativeScheduledJob[] }
    expect(result.ok).toBe(true)
    expect(result.value.map(job => job.state)).toEqual(['paused'])
    // The change reached the scheduler with the store's own state word.
    expect(runtime.calls).toEqual([{ id: 'first', state: 'paused' }])
  } finally {
    await runtime.host.stop()
  }
})

it('refuses to change a plan whose Session is not live', async () => {
  const runtime = await boot({ jobs: () => [row()], liveSessions: [] })
  try {
    const result = await runtime.dispatch('schedules/pause', { id: 'first' }, signal()) as
      { ok: boolean; error: { message: string } }
    expect(result.ok).toBe(false)
    expect(result.error.message).toContain('not open')
    // Permission boundary: nothing was handed to the scheduler at all.
    expect(runtime.calls).toEqual([])
  } finally {
    await runtime.host.stop()
  }
})

it('treats a second delete of the same plan as success', async () => {
  let jobs: Jobs = [row()]
  const runtime = await boot({
    jobs: () => jobs,
    change: () => { jobs = [] },
  })
  try {
    const first = await runtime.dispatch('schedules/delete', { id: 'first' }, signal()) as { ok: boolean }
    expect(first.ok).toBe(true)

    // Second click: the row is already gone. That is the outcome the user
    // asked for, so it must not surface as a failure.
    const second = await runtime.dispatch('schedules/delete', { id: 'first' }, signal()) as
      { ok: boolean; value: readonly NativeScheduledJob[] }
    expect(second.ok).toBe(true)
    expect(second.value).toEqual([])
    expect(runtime.calls).toHaveLength(1)
  } finally {
    await runtime.host.stop()
  }
})

it('surfaces a scheduler refusal instead of swallowing it', async () => {
  const runtime = await boot({
    jobs: () => [row({ state: 'paused' })],
    change: () => { throw new Error('Resumed execution would reach or exceed the schedule end time') },
  })
  try {
    const result = await runtime.dispatch('schedules/resume', { id: 'first' }, signal()) as
      { ok: boolean; error: { message: string } }
    expect(result.ok).toBe(false)
    // The store's own reason reaches the caller: a resumed window overrunning
    // its end time is a real refusal, not a generic failure.
    expect(result.error.message).toContain('end time')
  } finally {
    await runtime.host.stop()
  }
})

it('rejects a change request that carries no plan identity', async () => {
  const runtime = await boot({ jobs: () => [row()] })
  try {
    const result = await runtime.dispatch('schedules/pause', {}, signal()) as { ok: boolean }
    expect(result.ok).toBe(false)
    expect(runtime.calls).toEqual([])
  } finally {
    await runtime.host.stop()
  }
})
