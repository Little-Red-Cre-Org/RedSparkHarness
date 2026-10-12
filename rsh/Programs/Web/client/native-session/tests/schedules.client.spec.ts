/** Native schedule Client decodes the selected Host's unary and SSE responses. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeScheduleFrame, NativeScheduledJob } from '../src/schedule-types.ts'
import { createNativeSessionClient, nativeSubmissionRequestId, plugin as nativeSessionClient, type NativeSessionClient } from '../src/native.ts'

it('reads a typed slash-command catalog for the selected Session', async () => {
  const sessionId = 'command-catalog-session' as SessionId
  const catalog = { commands: [{ name: 'compact', description: 'Compact the current Session',
    input: { hint: '[target]', attachments: true } }] }
  const calls: unknown[] = []
  const rpc: ClientConnectionRpc = {
    call: async (channel, endpoint, payload) => {
      calls.push([channel, endpoint, payload])
      return { ok: true, value: catalog }
    },
  }
  const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 10000 })
  try {
    expect(await client.commands(sessionId)).toEqual(catalog.commands)
    expect(calls).toEqual([['/api', 'session/commands', { sessionId }]])
  } finally {
    await client.close()
  }
})

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

it('submits identified queue and steering requests and parses pending snapshots', async () => {
  const scope = new NativeScope()
  const sessionId = 'submission-client' as SessionId
  const queueId = nativeSubmissionRequestId('queue-client-id')
  const steerId = nativeSubmissionRequestId('steer-client-id')
  const requests: { endpoint: string; payload: unknown }[] = []
  const rpc: ClientConnectionRpc = {
    call: async (_channel, endpoint, payload) => {
      requests.push({ endpoint, payload })
      if (endpoint === 'session/queue') return { ok: true, value: { requestId: queueId, placement: 'queued', status: 'accepted' } }
      if (endpoint === 'session/steer') return { ok: true, value: { requestId: steerId, placement: 'steering', status: 'accepted' } }
      if (endpoint === 'session/dequeue') return { ok: true, value: { requestId: queueId } }
      if (endpoint === 'session/submissions') return { ok: true, value: { submissions: [
        { requestId: queueId, placement: 'queued', status: 'accepted' },
        { requestId: steerId, placement: 'steering', status: 'accepted' },
      ] } }
      throw new Error(`unexpected RPC endpoint ${endpoint}`)
    },
  }
  let sessions: NativeSessionClient | undefined
  const connectionProvider: NativePlugin = {
    apiVersion: 1, name: 'submission-client-connection', targets: ['client'], requires: [], provides: ['clientConnection'],
    resolve: () => (context) => { context.provide('clientConnection', { rpc } as never) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'submission-client-capture', targets: ['client'], requires: ['clientNativeSession'], provides: [],
    resolve: () => (context) => { sessions = context.require('clientNativeSession') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: connectionProvider, scope, config: undefined },
    { plugin: nativeSessionClient, scope, config: { maxFollowBufferChars: 10000 } },
    { plugin: capture, scope, config: undefined },
  ], 'client'))
  try {
    await host.start()
    if (sessions === undefined) throw new Error('Native Session Client was not provided')
    await expect(sessions.queue(sessionId, 'later', queueId)).resolves.toEqual({
      requestId: queueId, placement: 'queued', status: 'accepted',
    })
    await expect(sessions.steer(sessionId, 'next step', steerId)).resolves.toEqual({
      requestId: steerId, placement: 'steering', status: 'accepted',
    })
    await expect(sessions.dequeue(sessionId, queueId)).resolves.toBeUndefined()
    await expect(sessions.submissions(sessionId)).resolves.toEqual([
      { requestId: queueId, placement: 'queued', status: 'accepted' },
      { requestId: steerId, placement: 'steering', status: 'accepted' },
    ])
    expect(requests).toEqual([
      { endpoint: 'session/queue', payload: { sessionId, prompt: 'later', requestId: queueId } },
      { endpoint: 'session/steer', payload: { sessionId, prompt: 'next step', requestId: steerId } },
      { endpoint: 'session/dequeue', payload: { sessionId, requestId: queueId } },
      { endpoint: 'session/submissions', payload: { sessionId } },
    ])
  } finally {
    await host.stop()
  }
})
