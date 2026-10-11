/** Authenticated Native schedule RPC and change frames use the existing Host services. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeScheduleFrame, NativeScheduledJob } from '@deepseek-ai/dsh-client-native-session/schedule-types'
import { plugin as scheduleController } from '../src/native.ts'

it('lists safe schedule rows and follows baseline, upsert, and remove frames', async () => {
  const scope = new NativeScope()
  let jobs: NativeScheduledJob[] = [{ id: 'first', sessionId: 'owner' as NativeScheduledJob['sessionId'], title: 'First', state: 'active',
    schedule: '2026-10-11T12:00:00+08:00', timeZone: 'UTC+08:00', nextRunAt: 1791691200000 }]
  const listeners = new Set<() => void>()
  const scheduler = {
    listSchedules: () => jobs,
    onSchedulesChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  let dispatch: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let fetchSchedule: ((request: Request) => Promise<Response>) | undefined
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'schedule-test-connection', targets: ['host'], requires: [], provides: ['hostConnection'],
    resolve: () => (context) => { context.provide('hostConnection', {
      rpc: { intercept: (_channel: string, accepts: (endpoint: string) => boolean, handle: unknown) => {
        if (accepts('schedules/list')) dispatch = handle as typeof dispatch
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
  try {
    await host.start()
    if (dispatch === undefined || fetchSchedule === undefined) throw new Error('Native schedule routes were not installed')
    expect(await dispatch('schedules/list', {}, new AbortController().signal)).toEqual({ ok: true, value: jobs })
    expect(await dispatch('schedules/list', { prompt: 'not accepted' }, new AbortController().signal)).toMatchObject({
      ok: false, error: { code: 'native/schedules', message: 'Schedule request failed.', details: {} },
    })

    const abort = new AbortController()
    const response = await fetchSchedule(new Request('http://host/api/schedules/follow', {
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
    for (const listener of listeners) listener()
    expect(decode((await upsertRead).value!)).toEqual({ type: 'upsert', job: updated })

    const removeRead = reader.read()
    jobs = []
    for (const listener of listeners) listener()
    expect(decode((await removeRead).value!)).toEqual({ type: 'remove', id: 'first' })
    abort.abort()
    expect(await reader.read()).toMatchObject({ done: true })
  } finally {
    await host.stop()
  }
})
