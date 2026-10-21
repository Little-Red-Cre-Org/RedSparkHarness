/** Admission-local unread output is bounded and releases its follower on cancellation. */
import { expect, it, vi } from 'vitest'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import { NativeWebSessionService, resolveNativeWebSessionConfig } from '../src/native.ts'
import { NativeSessionFeed } from '../src/follow.ts'

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
  const executor: Pick<NativeHeadlessApplication, 'executeRootTurn'> = {
    async executeRootTurn(request, signal) {
      request.onChunk?.({ type: 'text-delta', index: 0, text: 'overflow' })
      entered.resolve(undefined)
      await cleanup.promise
      throw new AggregateError([signal.reason, new Error('fixture cleanup failure')], 'epoch cleanup failed')
    },
  }
  // Only turn execution participates in this transport settlement fixture.
  const service = new NativeWebSessionService(executor as NativeHeadlessApplication,
    {} as NativeSessionPersistenceOperations, {} as NativeActiveSessionOperations,
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
