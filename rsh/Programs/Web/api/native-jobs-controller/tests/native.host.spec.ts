/** Native background-job projection, deltas, and transport safety. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeJobSnapshot } from '@deepseek-ai/dsh-native-jobs'
import type { NativeSessionJob, NativeSessionJobsFrame } from '@deepseek-ai/dsh-client-native-session/jobs-types'
import { MIN_POLL_INTERVAL_MS, NativeJobsController, plugin as jobsController } from '../src/native.ts'

/** One Agent stand-in: the registry only exposes identity and scope to this projection. */
function agent(id: string, scope: NativeScope): NativeAgent {
  return { id: id as NativeAgent['id'], scope }
}

/** One job snapshot whose owner is an opaque Agent object that must not leak. */
function snapshot(id: string, owner: NativeAgent, overrides: Partial<NativeJobSnapshot> = {}): NativeJobSnapshot {
  return {
    id: id as NativeJobSnapshot['id'],
    kind: 'bash',
    label: `label-${id}`,
    owner,
    status: 'running',
    startedAt: 1000,
    ...overrides,
  }
}

/** Minimal registry pair accepted by the controller. */
function registries(agents: NativeAgent[], jobsByAgent: Map<NativeAgent, NativeJobSnapshot[]>) {
  return {
    agents: { list: () => agents } as never,
    jobs: { list: (owner: NativeAgent) => jobsByAgent.get(owner) ?? [] } as never,
  }
}

it('groups rows by the owning Agent id and drops the Agent object from the wire row', () => {
  const scope = new NativeScope()
  const first = agent('session-a', scope)
  const second = agent('session-b', scope)
  const { agents, jobs } = registries([first, second], new Map([
    [first, [snapshot('job-1', first), snapshot('job-2', first, { status: 'completed', finishedAt: 2000 })]],
    [second, [snapshot('job-3', second, { kind: 'grep', detail: 'two matches' })]],
  ]))
  const controller = new NativeJobsController(agents, jobs)

  const rows = controller.list()
  expect(rows.map(row => row.id)).toEqual(['job-1', 'job-2', 'job-3'])
  expect(rows.map(row => row.sessionId)).toEqual(['session-a', 'session-a', 'session-b'])
  expect(rows[2]).toMatchObject({ kind: 'grep', detail: 'two matches' })
  expect(rows[1]).toMatchObject({ status: 'completed', finishedAt: 2000 })

  // The Agent object is not serializable transport data: every row must be a
  // plain record with exactly the browser-facing keys.
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual(
      Object.keys(row).filter(key => key !== 'owner').sort(),
    )
    expect('owner' in row).toBe(false)
    expect(typeof row.id).toBe('string')
    expect(row.id).not.toBe((row as unknown as { owner?: unknown }).owner)
  }
})

it('emits upsert, remove, and session-gone deltas across successive polls', () => {
  const scope = new NativeScope()
  const first = agent('session-a', scope)
  const second = agent('session-b', scope)
  const state = new Map<NativeAgent, NativeJobSnapshot[]>([
    [first, [snapshot('job-1', first)]],
    [second, [snapshot('job-2', second)]],
  ])
  const { agents, jobs } = registries([first, second], state)
  const controller = new NativeJobsController(agents, jobs, 0)

  const initial = controller.list()
  expect(initial.map(row => row.id)).toEqual(['job-1', 'job-2'])
  expect(controller.poll(0)).toEqual([])

  state.set(first, [snapshot('job-1', first, { label: 'relabelled' })])
  expect(controller.poll(0)).toEqual<object[]>([
    { type: 'upsert', job: expect.objectContaining({ id: 'job-1', label: 'relabelled' }) as unknown },
  ])

  // An empty job set drops the Session from the projection entirely, so the
  // next poll reports the removal and the Session leaving the feed together.
  state.set(second, [])
  expect(controller.poll(0)).toEqual([
    { type: 'remove', id: 'job-2' },
    { type: 'session-gone', sessionId: 'session-b' },
  ])

  state.delete(second)
  expect(controller.poll(0)).toEqual([])

  state.delete(first)
  expect(controller.poll(0)).toEqual([
    { type: 'remove', id: 'job-1' },
    { type: 'session-gone', sessionId: 'session-a' },
  ])
})

it('floors successive registry re-reads instead of spinning on the event loop', () => {
  const scope = new NativeScope()
  const owner = agent('session-a', scope)
  const { agents, jobs } = registries([owner], new Map([[owner, [snapshot('job-1', owner)]]]))
  const controller = new NativeJobsController(agents, jobs)

  expect(MIN_POLL_INTERVAL_MS).toBe(1000)
  expect(controller.nextPollDelay(0)).toBe(0)
  controller.poll(0)
  // A drained stream asks again immediately; the interval must hold it back.
  expect(controller.nextPollDelay(0)).toBe(MIN_POLL_INTERVAL_MS)
  expect(controller.nextPollDelay(400)).toBe(MIN_POLL_INTERVAL_MS - 400)
  expect(controller.nextPollDelay(MIN_POLL_INTERVAL_MS)).toBe(0)
})

it('serves the list over RPC and a baseline plus deltas over the follow stream', async () => {
  const scope = new NativeScope()
  const owner = agent('session-a', scope)
  const state = new Map<NativeAgent, NativeJobSnapshot[]>([[owner, [snapshot('job-1', owner)]]])
  let dispatch: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let follow: ((request: Request) => Promise<Response>) | undefined

  const carrier: NativePlugin = {
    apiVersion: 1, name: 'jobs-test-connection', targets: ['host'], requires: [], provides: ['hostConnection'],
    resolve: () => (context) => {
      context.provide('hostConnection', {
        rpc: {
          intercept: (_channel: string, accepts: (endpoint: string) => boolean, handle: unknown) => {
            if (accepts('session/jobs/list')) dispatch = handle as typeof dispatch
            return () => { dispatch = undefined }
          },
        },
        fetch: {
          register: (route: { readonly path: string; readonly fetch: (request: Request) => Promise<Response> }) => {
            if (route.path === '/api/session/jobs/follow') follow = route.fetch
            return () => { follow = undefined }
          },
        },
      } as never)
    },
  }
  const agentsProvider: NativePlugin = {
    apiVersion: 1, name: 'jobs-test-agents', targets: ['host'], requires: [], provides: ['agents'],
    resolve: () => (context) => { context.provide('agents', { list: () => [owner] } as never) },
  }
  const jobsProvider: NativePlugin = {
    apiVersion: 1, name: 'jobs-test-jobs', targets: ['host'], requires: [], provides: ['jobs'],
    resolve: () => (context) => {
      context.provide('jobs', { list: (target: NativeAgent) => state.get(target) ?? [] } as never)
    },
  }

  const host = new NativeHost(resolveInstallation([
    { plugin: carrier, scope, config: undefined },
    { plugin: agentsProvider, scope, config: undefined },
    { plugin: jobsProvider, scope, config: undefined },
    { plugin: jobsController, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (dispatch === undefined || follow === undefined) throw new Error('Native jobs routes were not installed')

    expect(await dispatch('session/jobs/list', {}, new AbortController().signal)).toEqual({
      ok: true,
      value: [expect.objectContaining({ id: 'job-1', sessionId: 'session-a' })],
    })
    expect(await dispatch('session/jobs/list', { sessionId: 'nope' }, new AbortController().signal)).toMatchObject({
      ok: false, error: { code: 'native/jobs', message: 'Job request failed.', details: {} },
    })

    const abort = new AbortController()
    const response = await follow(new Request('http://host/api/session/jobs/follow', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: abort.signal,
    }))
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const decode = (chunk: Uint8Array): NativeSessionJobsFrame =>
      JSON.parse(new TextDecoder().decode(chunk).replace(/^data: /u, '').trim()) as NativeSessionJobsFrame

    const baseline = decode((await reader.read()).value!)
    expect(baseline.type).toBe('baseline')
    if (baseline.type !== 'baseline') throw new Error('expected baseline')
    expect(baseline.jobs.map((row: NativeSessionJob) => row.id)).toEqual(['job-1'])

    abort.abort()
    expect(await reader.read()).toMatchObject({ done: true })
  } finally {
    await host.stop()
  }
})
