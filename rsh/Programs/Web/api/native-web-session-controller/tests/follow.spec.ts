/** Admission-local unread output is bounded and releases its follower on cancellation. */
import { expect, it, vi } from 'vitest'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/native'
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
  const executor: Pick<NativeHeadlessApplication, 'executeRootTurn' | 'dispose'> = {
    async executeRootTurn(request, signal) {
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
    const start = await service.handle('session/start', { sessionId: 'overflow-session', text: 'input', resume: true, follow: true }, new AbortController().signal)
    if (!start.ok) throw new Error(start.error.message)
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
    cleanup.resolve(undefined)
    await service.close()
  }
})
