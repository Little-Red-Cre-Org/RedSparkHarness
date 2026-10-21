import { expect, it } from 'vitest'
import { NativeConnectionRequestAdmissionError, NativeConnectionRequestOwner } from '../src/native-request-owner.ts'

it('bounds admitted callbacks and waits for their cancellation cleanup', async () => {
  const lifetime = new AbortController()
  const request = new AbortController()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const owner = new NativeConnectionRequestOwner(lifetime.signal, 1)
  const running = owner.run(request.signal, async (signal) => {
    entered.resolve(undefined)
    await release.promise
    expect(signal.aborted).toBe(true)
  })
  await entered.promise
  await expect(owner.run(request.signal, async () => undefined)).rejects.toMatchObject({
    name: NativeConnectionRequestAdmissionError.name, reason: 'capacity',
  })

  const closed = owner.close()
  expect(owner.close()).toBe(closed)
  await expect(owner.run(request.signal, async () => undefined)).rejects.toMatchObject({ reason: 'closed' })
  release.resolve(undefined)
  await running
  await closed
  expect(owner.signal.aborted).toBe(true)
})
