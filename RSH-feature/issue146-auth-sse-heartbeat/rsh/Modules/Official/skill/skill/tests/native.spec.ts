import { setImmediate } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { NativeScope, RuntimeEvents } from '@deepseek-ai/dsh-native-runtime'
import { NativeSkillRegistry, plugin } from '../src/native.ts'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '../src/types.ts'

function candidate(name: string, provider: string, rank: number, description: string): SkillCandidate {
  return {
    name, description, invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom', provider, rank, locator: { name },
  }
}

function provider(name: string, skills: readonly SkillCandidate[], list: () => void = () => {}): SkillProvider {
  return {
    name,
    async list() { list(); return skills },
    async get(selected): Promise<SkillDefinition> { return { ...selected, content: `${selected.name} body` } },
  }
}

it('keeps Native skill providers layered by dynamic scope and invalidates only through the live registration', async () => {
  const root = new NativeScope()
  const agent = new NativeScope(root)
  const events = new RuntimeEvents()
  const registry = new NativeSkillRegistry(root, 2, events)
  let rootLists = 0
  let agentLists = 0
  let invalidateAgent = (): void => {}
  let invalidateOnAgentList = false
  try {
    expect(() => plugin.resolve(null)).toThrow('configuration must be an object')
    expect(() => plugin.resolve({ unknown: true })).toThrow('unknown configuration field')
    registry.registerProvider(root, () => provider('root', [candidate('review', 'root', 100, 'Root description')], () => { rootLists += 1 }))
    const removeAgent = registry.registerProvider(agent, (control) => {
      invalidateAgent = control.invalidate
      return provider('agent', [candidate('review', 'agent', 900, 'Agent description')], () => {
        agentLists += 1
        if (invalidateOnAgentList) invalidateAgent()
      })
    })

    expect(await registry.list({ scope: agent })).toMatchObject([{ provider: 'agent', description: 'Agent description' }])
    invalidateAgent()
    expect(await registry.list({ scope: agent })).toMatchObject([{ provider: 'agent', description: 'Agent description' }])
    expect({ rootLists, agentLists }).toEqual({ rootLists: 2, agentLists: 2 })

    invalidateOnAgentList = true
    invalidateAgent()
    expect(await registry.snapshot({ scope: agent })).toMatchObject({ complete: false })
    expect({ rootLists, agentLists }).toEqual({ rootLists: 4, agentLists: 4 })
    invalidateOnAgentList = false
    expect(await registry.snapshot({ scope: agent })).toMatchObject({ complete: true })
    expect({ rootLists, agentLists }).toEqual({ rootLists: 5, agentLists: 5 })

    await removeAgent()
    expect(await registry.get('review', { scope: agent })).toMatchObject({ provider: 'root', content: 'review body' })
    const cachedRootLists = rootLists
    invalidateAgent()
    await registry.list({ scope: agent })
    expect(rootLists).toBe(cachedRootLists)
  } finally {
    await registry.dispose()
    await events.close()
  }
})

it('drains admitted Native lookups when a provider or the registry is disposed', async () => {
  const root = new NativeScope()
  const events = new RuntimeEvents()
  const registry = new NativeSkillRegistry(root, 1, events)
  const started = Promise.withResolvers<undefined>()
  const releaseList = Promise.withResolvers<undefined>()
  let removalFinished = false
  let observation: Promise<Awaited<ReturnType<typeof registry.snapshot>>> | undefined
  let removal: Promise<void> | undefined
  try {
    const unregister = registry.registerProvider(root, () => ({
      name: 'held',
      async list() { started.resolve(undefined); await releaseList.promise; return [] },
      async get() { return undefined },
    }))
    observation = registry.snapshot({ scope: root })
    await started.promise
    removal = unregister().then(() => { removalFinished = true })
    await setImmediate()
    expect(removalFinished).toBe(false)

    releaseList.resolve(undefined)
    expect(await observation).toMatchObject({ complete: true, skills: [] })
    await removal
    expect(removalFinished).toBe(true)

    let emptySnapshotSettled = false
    const emptySnapshot = registry.snapshot({ scope: root }).then(
      () => { emptySnapshotSettled = true },
      () => { emptySnapshotSettled = true },
    )
    await registry.dispose()
    expect(emptySnapshotSettled).toBe(true)
    await emptySnapshot

    const runtimeRegistry = new NativeSkillRegistry(root, 1, events)
    try {
      runtimeRegistry.register(root, { name: 'cached', description: 'Cached runtime skill', source: 'custom', content: 'body' })
      await runtimeRegistry.snapshot({ scope: root })
      let cachedGetSettled = false
      const cachedGet = runtimeRegistry.get('cached', { scope: root }).then(
        () => { cachedGetSettled = true },
        () => { cachedGetSettled = true },
      )
      await runtimeRegistry.dispose()
      expect(cachedGetSettled).toBe(true)
      await cachedGet
    } finally {
      await runtimeRegistry.dispose()
    }
  } finally {
    releaseList.resolve(undefined)
    const pending = [
      ...(observation === undefined ? [] : [observation]),
      ...(removal === undefined ? [] : [removal]),
    ]
    await Promise.allSettled(pending)
    await registry.dispose()
    await events.close()
  }
})
