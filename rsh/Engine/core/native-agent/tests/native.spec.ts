/** Native Agent lifecycle and initiator behavior through a real native Host. */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '../src/index.ts'
import { plugin as agentPlugin } from '../src/index.ts'

async function fixture(): Promise<{ host: NativeHost; root: NativeScope; agents: NativeAgentRegistry }> {
  const root = new NativeScope()
  let agents: NativeAgentRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'native-agent-capture', targets: ['host'], requires: ['agents'], provides: [],
    resolve: () => (context) => { agents = context.require('agents') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope: root, config: undefined },
    { plugin: agentPlugin, scope: root, config: undefined },
  ], 'host'))
  await host.start()
  if (agents === undefined) throw new Error('native-agent fixture lost its registry')
  return { host, root, agents }
}

function agent(id: string, parent: NativeScope): NativeAgent {
  return { id: NativeAgentId(id), scope: new NativeScope(parent) }
}

function lifecycleEvents(host: NativeHost): {
  on(scope: NativeScope, key: 'agent/created' | 'agent/disposed', listener: (agent: NativeAgent) => void): () => Promise<void>
} {
  return host.events as unknown as {
    on(scope: NativeScope, key: 'agent/created' | 'agent/disposed', listener: (agent: NativeAgent) => void): () => Promise<void>
  }
}

describe('NativeAgentRegistry', () => {
  it('publishes paired scoped lifecycle events and rejects a duplicate live identity', async () => {
    const { host, root, agents } = await fixture()
    const events: string[] = []
    lifecycleEvents(host).on(root, 'agent/created', ({ id }) => { events.push(`created:${id}`) })
    lifecycleEvents(host).on(root, 'agent/disposed', ({ id }) => { events.push(`disposed:${id}`) })
    const first = agent('first', root)
    try {
      const dispose = agents.register(first)
      expect(agents.get(first.id)).toBe(first)
      expect(agents.list()).toEqual([first])
      expect(() => agents.register(first)).toThrow('already registered')
      await dispose()
      await dispose()
      expect(agents.list()).toEqual([])
      expect(events).toEqual(['created:first', 'disposed:first'])
    } finally {
      await host.stop()
    }
  })

  it('keeps concurrent initiators separate, restores clearing boundaries, and drains before release', async () => {
    const { host, root, agents } = await fixture()
    const first = agent('first', root)
    const second = agent('second', root)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let starts = 0
    try {
      const run = (initiator: NativeAgent) => agents.withInitiator(initiator, async () => {
        expect(agents.requireInitiator()).toBe(initiator)
        starts += 1
        if (starts === 2) entered.resolve(undefined)
        agents.withoutInitiator(() => {
          expect(agents.currentInitiator()).toBeUndefined()
          expect(() => agents.requireInitiator()).toThrow('no initiating Agent')
        })
        await release.promise
        expect(agents.requireInitiator()).toBe(initiator)
      })
      const pending = [run(first), run(second)]
      await entered.promise
      const draining = agents.dispose()
      expect(() => { agents.withInitiator(first, () => undefined) }).toThrow('initiator scope is disposed')
      release.resolve(undefined)
      await Promise.all(pending)
      await draining
      await host.stop()
      expect(() => agents.currentInitiator()).toThrow('initiator scope is disposed')
    } finally {
      release.resolve(undefined)
      await host.stop()
    }
  })

  it('unregisters an Agent when a creation listener rejects after observing it', async () => {
    const { host, root, agents } = await fixture()
    const events: string[] = []
    lifecycleEvents(host).on(root, 'agent/created', ({ id }) => { events.push(`first:${id}`) })
    lifecycleEvents(host).on(root, 'agent/created', () => { throw new Error('publication refused') })
    lifecycleEvents(host).on(root, 'agent/disposed', ({ id }) => { events.push(`disposed:${id}`) })
    const refused = agent('refused', root)
    try {
      expect(() => agents.register(refused)).toThrow('publication refused')
      expect(agents.get(refused.id)).toBeUndefined()
      expect(events).toEqual(['first:refused', 'disposed:refused'])
    } finally {
      await host.stop()
    }
  })

  it('drains Agent-owned cleanup before it announces disposal', async () => {
    const { host, root, agents } = await fixture()
    const owned = agent('owned', root)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const events: string[] = []
    lifecycleEvents(host).on(root, 'agent/disposed', ({ id }) => { events.push(`disposed:${id}`) })
    const unregister = agents.register(owned)
    agents.onDispose(owned, async () => {
      entered.resolve(undefined)
      await release.promise
    })
    try {
      const draining = unregister()
      await entered.promise
      expect(agents.get(owned.id)).toBeUndefined()
      expect(agents.list()).toEqual([])
      expect(events).toEqual([])
      expect(() => agents.onDispose(owned, () => undefined)).toThrow('not the registered instance')
      release.resolve(undefined)
      await draining
      expect(events).toEqual(['disposed:owned'])
    } finally {
      release.resolve(undefined)
      await host.stop()
    }
  })

  it('releases remaining Agents when the Host has already closed event admission', async () => {
    const { host, root, agents } = await fixture()
    agents.register(agent('remaining', root))
    await expect(host.stop()).resolves.toBeUndefined()
    expect(() => agents.currentInitiator()).toThrow('initiator scope is disposed')
  })
})
