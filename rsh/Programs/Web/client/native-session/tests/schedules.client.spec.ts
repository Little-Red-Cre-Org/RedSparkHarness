/** Native schedule Client decodes the selected Host's unary and SSE responses. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import type { NativeScheduleFrame, NativeScheduledJob } from '../src/schedule-types.ts'
import { plugin as nativeSessionClient } from '../src/native.ts'

it('lists schedule rows and decodes follow frames until caller cancellation', async () => {
  const scope = new NativeScope()
  const jobs: NativeScheduledJob[] = [{ id: 'job-1', sessionId: 'owner' as NativeScheduledJob['sessionId'], title: 'Review',
    state: 'active', schedule: '2026-10-11T12:00:00+08:00', timeZone: 'UTC+08:00', nextRunAt: 1791691200000 }]
  const frames: NativeScheduleFrame[] = [
    { type: 'baseline', jobs },
    { type: 'upsert', job: { ...jobs[0]!, state: 'paused' } },
    { type: 'remove', id: 'job-1' },
  ]
  const rpc: ClientConnectionRpc = {
    call: async (_channel, _endpoint, _payload) => ({ ok: true, value: jobs }),
    response: async (_channel, _endpoint, _payload, signal) => {
      const encoder = new TextEncoder()
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
          signal.addEventListener('abort', () => { controller.close() }, { once: true })
        },
      }), { headers: { 'content-type': 'text/event-stream' } })
    },
  }
  let schedules: import('../src/native.ts').NativeScheduleClient | undefined
  const connectionProvider: NativePlugin = {
    apiVersion: 1, name: 'schedule-client-connection', targets: ['client'], requires: [], provides: ['clientConnection'],
    resolve: () => (context) => { context.provide('clientConnection', { rpc } as never) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'schedule-client-capture', targets: ['client'], requires: ['clientNativeSchedule'], provides: [],
    resolve: () => (context) => { schedules = context.require('clientNativeSchedule') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: connectionProvider, scope, config: undefined },
    { plugin: nativeSessionClient, scope, config: { maxFollowBufferChars: 10000 } },
    { plugin: capture, scope, config: undefined },
  ], 'client'))
  try {
    await host.start()
    if (schedules === undefined) throw new Error('Native schedule Client was not provided')
    expect(await schedules.list()).toEqual(jobs)
    const abort = new AbortController()
    const following = schedules.follow(abort.signal)[Symbol.asyncIterator]()
    expect(await following.next()).toEqual({ done: false, value: frames[0] })
    expect(await following.next()).toEqual({ done: false, value: frames[1] })
    expect(await following.next()).toEqual({ done: false, value: frames[2] })
    abort.abort()
    expect(await following.next()).toMatchObject({ done: true })
  } finally {
    await host.stop()
  }
})
