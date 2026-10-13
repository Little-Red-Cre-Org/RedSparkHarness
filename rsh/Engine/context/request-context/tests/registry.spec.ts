import { expect, it, vi } from 'vitest'
import { setImmediate } from 'node:timers/promises'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import { NativeRequestContextProviderId, type NativeRequestContextProvider,
  type NativeRequestContextRequest } from '@deepseek-ai/dsh-request-context-definition'
import { NativeRequestContextRegistry } from '../src/index.ts'

function request(scope: NativeScope): NativeRequestContextRequest {
  return {
    owner: {} as unknown as NativeActiveSessionOwner,
    scope,
    turn: 1,
    step: 1,
    inputs: [],
    durableEvents: [],
    toolVisibility: { includes: () => false },
    signal: new AbortController().signal,
  }
}

function provider(
  id: string,
  order: number,
  text: string,
  commit: () => void = () => {},
): NativeRequestContextProvider {
  return {
    id: NativeRequestContextProviderId(id),
    order,
    async prepare() {
      return { messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })], commit }
    },
  }
}

it('orders visible shadow winners and rejects a prepared result removed before durable acceptance', async () => {
  const root = new NativeScope()
  const middle = new NativeScope(root)
  const dynamic = new NativeScope(new NativeScope(middle))
  const registry = new NativeRequestContextRegistry(root)
  expect(registry.hasProviders(dynamic)).toBe(false)
  expect(() => NativeRequestContextProviderId('')).toThrow('provider id must be nonempty')
  expect(() => registry.register(root, provider('fractional-order', 1.5, 'invalid'))).toThrow('safe integer')
  const committed: string[] = []
  const removeRootSkills = registry.register(root, provider('skills', 20, 'root', () => committed.push('root')))
  expect(removeRootSkills.isVisible(dynamic)).toBe(true)
  expect(registry.hasProviders(dynamic)).toBe(true)
  const removeChild = registry.register(middle, provider('skills', 10, 'child', () => committed.push('child')))
  expect(removeRootSkills.isVisible(dynamic)).toBe(false)
  expect(removeChild.isVisible(dynamic)).toBe(true)
  registry.register(root, provider('tail', 30, 'tail', () => committed.push('tail')))
  const accept = vi.fn(async (messages: readonly ReturnType<typeof createUserMessage>[]) => {
    expect(messages.map(message => message.content[0]?.type === 'text' ? message.content[0].text : '')).toEqual(['child', 'tail'])
    return 'accepted' as const
  })
  await expect(registry.prepareAndAccept(request(dynamic), accept)).resolves.toBe('accepted')
  expect(committed).toEqual(['child', 'tail'])

  let releasePreparation = (): void => {}
  const held = new Promise<void>((resolve) => { releasePreparation = resolve })
  let enteredPreparation = (): void => {}
  const entered = new Promise<void>((resolve) => { enteredPreparation = resolve })
  const removeHeld = registry.register(root, {
    ...provider('held', 40, 'late', () => committed.push('late')),
    async prepare() {
      enteredPreparation()
      await held
      return { messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'late' }] })],
        commit: () => committed.push('late') }
    },
  })
  const lateAccept = vi.fn(async () => 'accepted' as const)
  const pending = registry.prepareAndAccept(request(dynamic), lateAccept)
  await entered
  const removal = removeHeld()
  releasePreparation()
  await expect(pending).resolves.toBe('rejected')
  await removal
  expect(lateAccept).not.toHaveBeenCalled()
  expect(committed).toEqual(['child', 'tail'])
  await removeChild()
  expect(removeRootSkills.isVisible(dynamic)).toBe(true)
  await registry.dispose()
  expect(removeRootSkills.isVisible(dynamic)).toBe(false)

  const emptyRegistry = new NativeRequestContextRegistry(root)
  let releaseAcceptance = (): void => {}
  const acceptance = new Promise<void>((resolve) => { releaseAcceptance = resolve })
  let enteredAcceptance = (): void => {}
  const acceptedCallbackEntered = new Promise<void>((resolve) => { enteredAcceptance = resolve })
  const noProviderAccept = emptyRegistry.prepareAndAccept(request(dynamic), async () => {
    enteredAcceptance()
    await acceptance
    return 'accepted'
  })
  await acceptedCallbackEntered
  let drained = false
  const disposal = emptyRegistry.dispose().then(() => { drained = true })
  let drainedBeforeRelease = false
  try {
    await setImmediate()
    drainedBeforeRelease = drained
  } finally {
    releaseAcceptance()
    await Promise.allSettled([noProviderAccept, disposal])
  }
  await expect(noProviderAccept).resolves.toBe('accepted')
  await disposal
  expect(drainedBeforeRelease).toBe(false)
  expect(drained).toBe(true)
})
