/** Native Agent-owned jobs through a real native Host. */
import { describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { NativeJobId, type NativeJobOutcome, type NativeJobRegistry } from '../src/index.ts'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as jobsPlugin } from '../src/index.ts'

async function fixture(config?: unknown): Promise<{
  host: NativeHost
  root: NativeScope
  agents: NativeAgentRegistry
  jobs: NativeJobRegistry
}> {
  const root = new NativeScope()
  let agents: NativeAgentRegistry | undefined
  let jobs: NativeJobRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'native-jobs-capture', targets: ['host'], requires: ['agents', 'jobs'], provides: [],
    resolve: () => (context) => {
      agents = context.require('agents')
      jobs = context.require('jobs')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope: root, config: undefined },
    { plugin: jobsPlugin, scope: root, config },
    { plugin: agentPlugin, scope: root, config: undefined },
  ], 'host'))
  await host.start()
  if (agents === undefined || jobs === undefined) throw new Error('native-jobs fixture lost a service')
  return { host, root, agents, jobs }
}

function agent(id: string, parent: NativeScope): NativeAgent {
  return { id: NativeAgentId(id), scope: new NativeScope(parent) }
}

describe('NativeJobRegistry', () => {
  it('owns output and completion state under one exact registered Agent', async () => {
    const { host, root, agents, jobs } = await fixture()
    const owner = agent('owner', root)
    const release = Promise.withResolvers<undefined>()
    const unregister = agents.register(owner)
    try {
      const id = jobs.start({
        agent: owner, kind: 'subagent', label: 'inspect workspace',
        async run() {
          await release.promise
          return { status: 'completed', detail: 'completed normally', output: 'result text' }
        },
      })
      expect(id).toBe(NativeJobId('subagent-1'))
      expect(jobs.get(id, owner)).toMatchObject({ id, status: 'running', owner })
      expect(jobs.read(id, owner).output).toBe('')
      release.resolve(undefined)
      await expect(jobs.wait(id, owner, 1_000)).resolves.toMatchObject({ status: 'completed', detail: 'completed normally' })
      expect(jobs.read(id, owner)).toMatchObject({ output: 'result text', snapshot: { status: 'completed' } })
    } finally {
      release.resolve(undefined)
      await unregister()
      await host.stop()
    }
  })

  it('cancels only a wait when its caller aborts', async () => {
    const { host, root, agents, jobs } = await fixture()
    const owner = agent('owner', root)
    const unregister = agents.register(owner)
    const release = Promise.withResolvers<undefined>()
    try {
      const id = jobs.start({
        agent: owner, kind: 'subagent', label: 'independent work',
        async run() { await release.promise; return { status: 'completed', output: 'finished' } },
      })
      const controller = new AbortController()
      const waiting = jobs.wait(id, owner, 60_000, controller.signal)
      controller.abort(new Error('caller stopped waiting'))
      await expect(waiting).rejects.toThrow('caller stopped waiting')
      expect(jobs.get(id, owner).status).toBe('running')
      release.resolve(undefined)
      await expect(jobs.wait(id, owner, 1_000)).resolves.toMatchObject({ status: 'completed' })
    } finally {
      release.resolve(undefined)
      await unregister()
      await host.stop()
    }
  })

  it('fences foreign and stale Agent objects before disclosure or cancellation', async () => {
    const { host, root, agents, jobs } = await fixture()
    const owner = agent('owner', root)
    const foreign = agent('foreign', root)
    const stale = { ...owner }
    const ownerRelease = agents.register(owner)
    const foreignRelease = agents.register(foreign)
    try {
      const id = jobs.start({ agent: owner, kind: 'shell', label: 'long operation', run: async () => ({ status: 'completed' }) })
      await jobs.wait(id, owner, 1_000)
      expect(() => jobs.get(id, foreign)).toThrow('belongs to another Agent')
      expect(() => jobs.get(id, stale)).toThrow('not the registered instance')
    } finally {
      await foreignRelease()
      await ownerRelease()
      await host.stop()
    }
  })

  it('applies the configured live-job limit before starting another runner', async () => {
    const { host, root, agents, jobs } = await fixture({ maxConcurrentPerAgent: 1 })
    const owner = agent('owner', root)
    const release = Promise.withResolvers<undefined>()
    const unregister = agents.register(owner)
    try {
      jobs.start({ agent: owner, kind: 'shell', label: 'first', async run() { await release.promise; return { status: 'completed' } } })
      const second = vi.fn(async () => ({ status: 'completed' as const }))
      expect(() => jobs.start({ agent: owner, kind: 'shell', label: 'second', run: second }))
        .toThrow('live-job limit reached')
      expect(second).not.toHaveBeenCalled()
    } finally {
      release.resolve(undefined)
      await unregister()
      await host.stop()
    }
  })

  it('cancels and drains Agent-owned work before its Agent emits disposal', async () => {
    const { host, root, agents, jobs } = await fixture()
    const owner = agent('owner', root)
    const stopped = Promise.withResolvers<undefined>()
    const events: string[] = []
    const unregister = agents.register(owner)
    const lifecycle = host.events as unknown as {
      on(scope: NativeScope, key: 'agent/disposed', listener: (value: NativeAgent) => void): () => Promise<void>
    }
    lifecycle.on(root, 'agent/disposed', ({ id }) => { events.push(`disposed:${id}`) })
    try {
      jobs.start({
        agent: owner, kind: 'shell', label: 'owned runner',
        run: async signal => await new Promise<NativeJobOutcome>((resolve) => {
          signal.addEventListener('abort', () => {
            stopped.resolve(undefined)
            resolve({ status: 'cancelled', detail: String(signal.reason) })
          }, { once: true })
        }),
      })
      const releasing = unregister()
      await stopped.promise
      expect(events).toEqual([])
      await releasing
      expect(agents.get(owner.id)).toBeUndefined()
      expect(events).toEqual(['disposed:owner'])
    } finally {
      await host.stop()
    }
  })

  it('aborts live work at explicit cancellation and registry disposal, then drains it', async () => {
    const { host, root, agents, jobs } = await fixture()
    const owner = agent('owner', root)
    const unregister = agents.register(owner)
    try {
      const run = vi.fn<(signal: AbortSignal) => Promise<NativeJobOutcome>>(signal => new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          resolve({ status: 'cancelled', detail: String(signal.reason) })
        }, { once: true })
      }))
      const id = jobs.start({ agent: owner, kind: 'workflow', label: 'cooperative', run })
      expect(jobs.cancel(id, owner, 'user stopped')).toBe('requested')
      await expect(jobs.wait(id, owner, 1_000)).resolves.toMatchObject({ status: 'cancelled', detail: 'user stopped' })

      const disposalRun = vi.fn<(signal: AbortSignal) => Promise<NativeJobOutcome>>(signal => new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
      }))
      jobs.start({ agent: owner, kind: 'workflow', label: 'disposed', run: disposalRun })
      await host.stop()
      expect(disposalRun).toHaveBeenCalledOnce()
      expect(() => jobs.list(owner)).toThrow('registry is disposed')
    } finally {
      await unregister()
      await host.stop()
    }
  })
})
