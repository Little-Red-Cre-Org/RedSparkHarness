/** Admission-local unread output is bounded and releases its follower on cancellation. */
import { expect, it, vi } from 'vitest'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeTurnRequest } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/list-types'
import { NativeWebSessionService, resolveNativeWebSessionConfig } from '../src/native.ts'
import { NativeSessionFeed } from '../src/follow.ts'
import { NativeSessionListFeed } from '../src/session-list-follow.ts'

it('sends a list baseline, coalesced updates and removal before releasing its follower', async () => {
  const sessionId = SessionId('list-follow')
  const item: NativeSessionListItem = {
    header: { id: sessionId, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false },
    titleProjection: { status: 'absent' }, updatedAt: 1, blank: true, running: false,
    completed: false, runningSubagentCount: 0, hasActiveSchedule: false,
  }
  let present = true
  const release = vi.fn()
  const feed = new NativeSessionListFeed(1000, release)
  const reader = feed.response(new AbortController().signal, async () => [item], async () => present ? item : undefined)
    .body!.getReader()
  const readFrame = async (): Promise<string> => {
    const result = await reader.read()
    if (result.done) throw new Error('list stream ended before its frame')
    return new TextDecoder().decode(result.value)
  }

  expect(await readFrame()).toContain('"type":"baseline"')
  feed.push(sessionId)
  feed.push(sessionId)
  expect(await readFrame()).toContain('"type":"upsert"')
  present = false
  feed.push(sessionId)
  expect(await readFrame()).toContain('"type":"remove"')
  await reader.cancel()
  expect(release).toHaveBeenCalledOnce()
})

it('splits oversized list baselines and skips oversized upserts', async () => {
  const makeItem = (id: string, title?: string): NativeSessionListItem => ({
    header: { id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false },
    titleProjection: title === undefined ? { status: 'absent' } : { status: 'resolved', title },
    updatedAt: 1, blank: true, running: false, completed: false,
    runningSubagentCount: 0, hasActiveSchedule: false,
  })
  const first = makeItem('list-small-a')
  const second = makeItem('list-small-b')
  const oversized = makeItem('list-large', 'x'.repeat(1000))
  const encoder = new TextEncoder()
  const frameBytes = (frame: unknown): number => encoder.encode(`data: ${JSON.stringify(frame)}\n\n`).byteLength
  const release = vi.fn()
  const feed = new NativeSessionListFeed(frameBytes({ type: 'upsert', item: first }), release)
  const items = new Map([[first.header.id, first], [second.header.id, second], [oversized.header.id, oversized]])
  const reader = feed.response(new AbortController().signal, async () => [first, oversized, second],
    async id => items.get(id)).body!.getReader()
  const readFrame = async (): Promise<Record<string, unknown>> => {
    const result = await reader.read()
    if (result.done) throw new Error('list stream ended before its frame')
    return JSON.parse(new TextDecoder().decode(result.value).slice(6)) as Record<string, unknown>
  }

  expect(await readFrame()).toEqual({ type: 'baseline', items: [] })
  expect(await readFrame()).toEqual({ type: 'upsert', item: first })
  expect(await readFrame()).toEqual({ type: 'upsert', item: second })
  feed.push(oversized.header.id)
  feed.push(second.header.id)
  expect(await readFrame()).toEqual({ type: 'upsert', item: second })
  await reader.cancel()
  expect(release).toHaveBeenCalledOnce()
})

it('rejects oversized unread output and detaches a cancelled follower exactly once', async () => {
  const overflow = vi.fn()
  const refused = new NativeSessionFeed(1, overflow)
  refused.push({ type: 'text', text: '€' })
  expect(overflow).toHaveBeenCalledOnce()
  const refusedRelease = vi.fn()
  await expect(refused.response(new AbortController().signal, refusedRelease).body!.getReader().read()).rejects.toThrow('byte limit')
  expect(refusedRelease).toHaveBeenCalledOnce()

  const feed = new NativeSessionFeed(1000, overflow)
  const controller = new AbortController()
  const release = vi.fn()
  const reader = feed.response(controller.signal, release).body!.getReader()
  const pending = reader.read()
  controller.abort()
  expect(await pending).toMatchObject({ done: true })
  feed.push({ type: 'text', text: 'late output' })
  feed.finish()
  expect(await reader.read()).toMatchObject({ done: true })
  expect(release).toHaveBeenCalledOnce()

  const entered = Promise.withResolvers<undefined>()
  const cleanup = Promise.withResolvers<undefined>()
  const followed = Promise.withResolvers<undefined>()
  const executor: Pick<NativeHeadlessApplication, 'executeRootTurn' | 'dispose'> = {
    async executeRootTurn(request, signal) {
      await followed.promise
      request.onChunk?.({ type: 'text-delta', index: 0, text: 'overflow' })
      entered.resolve(undefined)
      await cleanup.promise
      throw new AggregateError([signal.reason, new Error('fixture cleanup failure')], 'epoch cleanup failed')
    },
    async dispose() {},
  }
  const active = {
    owners: () => [],
    onAttached: () => () => Promise.resolve(),
    onDetached: () => () => Promise.resolve(),
  } as unknown as NativeActiveSessionOperations
  // Only turn execution participates in this transport settlement fixture.
  const service = new NativeWebSessionService(executor as NativeHeadlessApplication,
    {} as NativeSessionPersistenceOperations, active,
    resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 1,
      maxPendingRequests: 1, maxHistoryEvents: 1, maxPromptChars: 100, maxFollowBufferBytes: 1,
      maxFollowers: 1, maxPendingHumanRequests: 2 }),
    new AbortController().signal)
  try {
    const start = await service.handle('session/start', { sessionId: 'overflow-session', text: 'input', resume: true, follow: true, lastSeq: -1 }, new AbortController().signal)
    if (!start.ok) throw new Error(start.error.message)
    // Overflow cancels the turn only while a follower is connected.
    const follow = await service.follow(new Request('http://localhost/api/native-session/follow', { method: 'POST',
      body: JSON.stringify({ sessionId: 'overflow-session', ...(start.value as { admissionId: string }) }) }))
    expect(follow.status).toBe(200)
    followed.resolve(undefined)
    await entered.promise
    let settled = false
    const pending = service.handle('session/await', { sessionId: 'overflow-session', ...(start.value as { admissionId: string }) }, new AbortController().signal)
    void pending.then(() => { settled = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    cleanup.resolve(undefined)
    const outcome = await pending
    if (outcome.ok) throw new Error('overflow unexpectedly settled successfully')
    expect(outcome.error.message).toContain('byte limit')
    expect(outcome.error.message).toContain('epoch cleanup failed')
  } finally {
    followed.resolve(undefined)
    cleanup.resolve(undefined)
    await service.close()
  }
})

it('sends a bounded baseline cursor before missing and buffered Session events', async () => {
  const sessionId = SessionId('baseline-follow')
  const feed = new NativeSessionFeed(10_000, () => { throw new Error('unexpected follow overflow') })
  const beforeBaseline = { type: 'session/end-seed', seq: 0, time: 1, data: {} } as SessionEvent
  const afterBaseline = { type: 'session/end-seed', seq: 2, time: 3, data: {} } as SessionEvent
  feed.push({ type: 'event', event: beforeBaseline })
  feed.push({ type: 'event', event: afterBaseline })
  feed.setBaseline(sessionId, -1, [beforeBaseline, { type: 'session/end-seed', seq: 1, time: 2, data: {} } as SessionEvent])
  feed.finish()

  const reader = feed.response(new AbortController().signal, () => undefined).body!.getReader()
  const frames: unknown[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) break
    const serialized = new TextDecoder().decode(result.value).trim().slice('data: '.length)
    frames.push(JSON.parse(serialized))
  }
  expect(frames).toEqual([
    { type: 'baseline', sessionId, fromSeq: -1, throughSeq: 1 },
    { type: 'event', event: beforeBaseline },
    { type: 'event', event: { type: 'session/end-seed', seq: 1, time: 2, data: {} } },
    { type: 'event', event: afterBaseline },
    { type: 'settled' },
  ])
})

it('queues and steers identified inputs through the active root inbox', async () => {
  const sessionId = SessionId('queued-submissions')
  const accepted = Promise.withResolvers<NativeTurnRequest>()
  const settled = Promise.withResolvers<{ exitCode: number }>()
  const pending: Record<'next-turn' | 'next-step', ReturnType<typeof createUserMessage>[]> = {
    'next-turn': [], 'next-step': [],
  }
  const imagePrepared = Promise.withResolvers<undefined>()
  const duplicateReachedDirectory = Promise.withResolvers<undefined>()
  const releaseDuplicateDirectory = Promise.withResolvers<undefined>()
  const releaseImagePreparation = Promise.withResolvers<undefined>()
  const imageBlock = { type: 'image', attachment: { attachmentId: 'queued-image', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } } as unknown as ContentBlock
  let directoryCalls = 0
  let imageAdmissions = 0
  const selections = {
    directory: { resolve: async () => {
      directoryCalls++
      if (directoryCalls === 2) { duplicateReachedDirectory.resolve(undefined); await releaseDuplicateDirectory.promise }
      return { inputModalities: ['image'] }
    } },
    attachments: { admitPromptContent: async () => {
      imageAdmissions++
      imagePrepared.resolve(undefined)
      await releaseImagePreparation.promise
      return [imageBlock]
    } },
  } as unknown as ConstructorParameters<typeof NativeWebSessionService>[5]
  const imageSubmissions: Promise<unknown>[] = []
  const events: SessionEvent[] = []
  let acceptedRequest!: NativeTurnRequest
  let seq = 0
  const record = (type: SessionEvent['type'], data: unknown): SessionEvent => {
    const event = { type, seq: seq++, time: seq, data } as SessionEvent
    events.push(event)
    acceptedRequest.onEvent?.(event)
    return event
  }
  const owner = {
    agent: {}, session: { id: sessionId }, invocation: 'root', writerAvailable: true,
    onEvent: () => () => {},
    readEvents: async () => events,
    messages: (target: 'next-turn' | 'next-step') => pending[target],
    enqueue: async (message: ReturnType<typeof createUserMessage>, target: 'next-turn' | 'next-step') => {
      pending[target].push(message)
      record('agent/inbox/spliced', { target, start: pending[target].length - 1, inserted: [message] })
      return message.id
    },
    remove: async (ids: readonly string[], target: 'next-turn' | 'next-step') => {
      const start = pending[target].findIndex(message => ids.includes(message.id))
      const removed = pending[target].filter(message => ids.includes(message.id))
      pending[target] = pending[target].filter(message => !ids.includes(message.id))
      record('agent/inbox/spliced', { target, start, removedCount: removed.length, inserted: [], outcome: 'canceled' })
    },
  }
  const active = {
    owners: () => [owner], owner: () => owner, onAttached: () => () => {}, onDetached: () => () => {},
  } as unknown as NativeActiveSessionOperations
  const executor = {
    rootExecution: { capture: () => ({ id: 'root' }) },
    async executeRootTurn(request: NativeTurnRequest, signal: AbortSignal) {
      acceptedRequest = request
      accepted.resolve(request)
      await request.onBaseline?.(owner as unknown as NativeActiveSessionOwner, signal)
      return settled.promise
    },
    dispose: async () => undefined,
  } as unknown as NativeHeadlessApplication
  const service = new NativeWebSessionService(executor, {} as NativeSessionPersistenceOperations, active,
    resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 1,
      maxPendingRequests: 4, maxHistoryEvents: 1, maxPromptChars: 100, maxFollowBufferBytes: 100000,
      maxFollowers: 1, maxPendingHumanRequests: 1 }), new AbortController().signal, selections)
  try {
    const started = await service.handle('session/start', { sessionId, text: 'current turn', resume: true, follow: true, lastSeq: -1 }, new AbortController().signal)
    if (!started.ok) throw new Error(started.error.message)
    await accepted.promise
    const queueId = 'queued-request'
    const steerId = 'steering-request'
    await expect(service.handle('session/queue', { sessionId, prompt: 'later', requestId: queueId }, new AbortController().signal))
      .resolves.toMatchObject({ ok: true, value: { requestId: queueId, placement: 'queued', status: 'accepted' } })
    await expect(service.handle('session/steer', { sessionId, prompt: 'next step', requestId: steerId }, new AbortController().signal))
      .resolves.toMatchObject({ ok: true, value: { requestId: steerId, placement: 'steering', status: 'accepted' } })
    const claimedSteer = pending['next-step'].shift()
    if (claimedSteer === undefined) throw new Error('missing claimed steering fixture message')
    record('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] })
    record('user/message', claimedSteer)
    const canceledId = 'canceled-request'
    await expect(service.handle('session/queue', { sessionId, prompt: 'remove me', requestId: canceledId }, new AbortController().signal))
      .resolves.toMatchObject({ ok: true, value: { requestId: canceledId, placement: 'queued', status: 'accepted' } })
    await expect(service.handle('session/dequeue', { sessionId, requestId: canceledId }, new AbortController().signal))
      .resolves.toMatchObject({ ok: true, value: { requestId: canceledId } })
    await expect(service.handle('session/submissions', { sessionId }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { throughSeq: seq - 1, submissions: [
        { requestId: queueId, placement: 'queued', status: 'accepted', message: {
          id: queueId, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'later' }],
        } },
      ] },
    })
    await expect(service.handle('session/start', { sessionId, text: 'second turn', resume: true }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false })

    const imageRequestId = 'image-duplicate-request'
    const imageRequest = { sessionId, content: [{ type: 'image', mediaType: 'image/png', data: 'AQ==' }], requestId: imageRequestId }
    const imageSubmission = service.handle('session/queue', imageRequest, new AbortController().signal)
    imageSubmissions.push(imageSubmission)
    await imagePrepared.promise
    const duplicateSubmission = service.handle('session/queue', imageRequest, new AbortController().signal)
    imageSubmissions.push(duplicateSubmission)
    const duplicateOutcome = await Promise.race([
      duplicateSubmission.then(value => ({ type: 'reply' as const, value })),
      duplicateReachedDirectory.promise.then(() => ({ type: 'preparing' as const })),
    ])
    expect(duplicateOutcome.type).toBe('reply')
    if (duplicateOutcome.type === 'reply') expect(duplicateOutcome.value).toMatchObject({
      ok: false, error: { message: 'native web session: duplicate submission request id' },
    })
    expect(imageAdmissions).toBe(1)
    releaseDuplicateDirectory.resolve(undefined)
    releaseImagePreparation.resolve(undefined)
    await expect(imageSubmission).resolves.toMatchObject({ ok: true, value: {
      requestId: imageRequestId, placement: 'queued', status: 'accepted',
    } })
    expect(pending['next-turn'].find(message => message.id === imageRequestId)?.content).toEqual([imageBlock])
    await expect(service.handle('session/dequeue', { sessionId, requestId: imageRequestId }, new AbortController().signal))
      .resolves.toMatchObject({ ok: true, value: { requestId: imageRequestId } })

    const admissionId = (started.value as { admissionId: string }).admissionId
    const response = await service.follow(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ sessionId, admissionId }) }))
    const queuedMessage = pending['next-turn'].shift()
    if (queuedMessage === undefined) throw new Error('missing next-turn fixture message')
    record('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
    record('user/message', queuedMessage)
    record('turn/end', { turn: 1, reason: { kind: 'completed' } })
    settled.resolve({ exitCode: 0 })
    const frames: unknown[] = []
    const reader = response.body!.getReader()
    while (true) {
      const frame = await reader.read()
      if (frame.done) break
      frames.push(...new TextDecoder().decode(frame.value).trim().split('\n\n')
        .map(line => JSON.parse(line.slice(6)) as unknown))
    }
    expect(frames.filter((frame): frame is { type: string; requestId: string; status: string } =>
      typeof frame === 'object' && frame !== null && 'type' in frame && frame.type === 'submission-update'))
      .toEqual([
        { type: 'submission-update', requestId: queueId, status: 'accepted' },
        { type: 'submission-update', requestId: steerId, status: 'accepted' },
        { type: 'submission-update', requestId: canceledId, status: 'accepted' },
        { type: 'submission-update', requestId: canceledId, status: 'rejected' },
        { type: 'submission-update', requestId: imageRequestId, status: 'accepted' },
        { type: 'submission-update', requestId: imageRequestId, status: 'rejected' },
        { type: 'submission-update', requestId: queueId, status: 'settled' },
        { type: 'submission-update', requestId: steerId, status: 'settled' },
      ])
    const rejected = await service.handle('session/queue', { sessionId, prompt: 'late', requestId: 'rejected-request' }, new AbortController().signal)
    expect(rejected).toMatchObject({ ok: false, error: { details: { requestId: 'rejected-request' } } })
    await service.handle('session/await', { sessionId, admissionId }, new AbortController().signal)
  } finally {
    releaseDuplicateDirectory.resolve(undefined)
    releaseImagePreparation.resolve(undefined)
    await Promise.allSettled(imageSubmissions)
    settled.resolve({ exitCode: 0 })
    await service.close()
  }
})
