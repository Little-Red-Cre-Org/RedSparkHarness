/** Admission-local unread output is bounded and releases its follower on cancellation. */
import { expect, it, vi } from 'vitest'
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
})
