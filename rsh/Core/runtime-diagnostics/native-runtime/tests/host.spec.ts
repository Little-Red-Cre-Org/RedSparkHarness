/** Native lifecycle behavior, independent of Cordis composition. */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeContext, type InstallationRequest } from '../src/index.ts'

declare module '../src/index.ts' {
  interface NativeServices {
    value: { read(): number }
    other: { read(): number }
  }
}

declare module '../src/index.ts' {
  interface NativeEvents {
    hold: { mode: 'serial'; args: []; result: undefined }
  }
}

function plugin(name: string, overrides: Partial<NativePlugin> = {}): NativePlugin {
  return { name, apiVersion: 1, targets: ['host', 'client'], requires: [], provides: [], resolve: () => () => {}, ...overrides }
}

const deferred = () => Promise.withResolvers<undefined>()

describe('native installation', () => {
  it('drains a grouped scope before replacing a sibling and preserves an unrelated scope', async () => {
    const scope = new NativeScope()
    const descendant = new NativeScope(scope)
    const unrelatedScope = new NativeScope()
    const entered = deferred()
    const finish = deferred()
    const cancelled = deferred()
    const trace: string[] = []
    let generation = 0
    const group: InstallationRequest = { scope, config: {}, plugin: plugin('group', { resolve: () => (ctx) => {
      const current = ++generation
      ctx.groupInstallations()
      ctx.signal.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
      ctx.on('hold', async () => { entered.resolve(undefined); await finish.promise; trace.push(`settled ${current}`) })
      ctx.own(() => { trace.push(`released ${current}`) })
      trace.push(`activated ${current}`)
    } }) }
    const member: InstallationRequest = { scope: descendant, config: {}, plugin: plugin('member', {
      resolve: () => (ctx) => { ctx.own(() => { trace.push('member released') }) },
    }) }
    let unrelatedActivations = 0
    const unrelated: InstallationRequest = { scope: unrelatedScope, config: {}, plugin: plugin('unrelated', {
      resolve: () => () => { unrelatedActivations++ },
    }) }
    const host = new NativeHost(resolveInstallation([group, member, unrelated], 'host'))
    try {
      await host.start()
      await host.replace(resolveInstallation([group, member, unrelated], 'host'))
      expect(generation).toBe(1)
      const delivery = host.events.serial(scope, 'hold')
      await entered.promise
      const replacement = host.replace(resolveInstallation([group, { ...member }, unrelated], 'host'))
      await cancelled.promise
      expect(trace).toEqual(['activated 1'])
      finish.resolve(undefined)
      await Promise.all([delivery, replacement])
      expect(trace).toEqual(['activated 1', 'settled 1', 'member released', 'released 1', 'activated 2'])
      expect(unrelatedActivations).toBe(1)
    } finally { finish.resolve(undefined); await host.stop() }
  })

  it('removes every grouped installation and retains independent owners', async () => {
    const scope = new NativeScope()
    const group = { scope, config: {}, plugin: plugin('group', { resolve: () => (ctx) => { ctx.groupInstallations() } }) }
    const member = { scope: new NativeScope(scope), config: {}, plugin: plugin('member') }
    const unrelated = { scope: new NativeScope(), config: {}, plugin: plugin('unrelated') }
    const host = new NativeHost(resolveInstallation([group, member, unrelated], 'host'))
    try {
      await host.start()
      await host.remove(member)
      expect(host.diagnostics().filter(entry => entry.state === 'ready').map(entry => entry.name)).toEqual(['unrelated'])
    } finally { await host.stop() }
  })

  it('restarts unchanged group members after an ancestor provider changes or a new member is added', async () => {
    const root = new NativeScope()
    const scope = new NativeScope(root)
    const provider = { scope: root, config: {}, plugin: plugin('provider', {
      provides: ['value'], resolve: () => (ctx) => { ctx.provide('value', { read: () => 1 }) },
    }) }
    let groupActivations = 0
    let memberActivations = 0
    const group = { scope, config: {}, plugin: plugin('group', { requires: ['value'], resolve: () => (ctx) => {
      ctx.require('value')
      ctx.groupInstallations()
      groupActivations++
    } }) }
    const member = { scope, config: {}, plugin: plugin('member', { resolve: () => () => { memberActivations++ } }) }
    const host = new NativeHost(resolveInstallation([provider, group, member], 'host'))
    try {
      await host.start()
      const changed = { ...provider }
      await host.replace(resolveInstallation([changed, group, member], 'host'))
      expect([groupActivations, memberActivations]).toEqual([2, 2])
      const added = { scope: new NativeScope(scope), config: {}, plugin: plugin('added') }
      await host.replace(resolveInstallation([changed, group, member, added], 'host'))
      expect([groupActivations, memberActivations]).toEqual([3, 3])
    } finally { await host.stop() }
  })

  it('releases a grouping registration early without grouping a later replacement', async () => {
    const scope = new NativeScope()
    let release: (() => Promise<void>) | undefined
    let activations = 0
    const group = { scope, config: {}, plugin: plugin('group', { resolve: () => (ctx) => {
      activations++
      release = ctx.groupInstallations()
    } }) }
    const member = { scope, config: {}, plugin: plugin('member') }
    const host = new NativeHost(resolveInstallation([group, member], 'host'))
    try {
      await host.start()
      expect(release).toBeDefined()
      await release!()
      await release!()
      await host.replace(resolveInstallation([group, { ...member }], 'host'))
      expect(activations).toBe(1)
    } finally { await host.stop() }
  })

  it('reports dependency selection and cleanup without exposing configuration', async () => {
    const scope = new NativeScope()
    const secret = 'private-config-value'
    Object.assign(scope, { attachedConfig: secret })
    const provider: InstallationRequest = { scope, config: { secret }, plugin: plugin('provider', {
      provides: ['value'], resolve: () => (ctx) => { ctx.provide('value', { read: () => 1 }) },
    }) }
    const consumer: InstallationRequest = { scope, config: {}, plugin: plugin('consumer', { requires: ['value'] }) }
    const host = new NativeHost(resolveInstallation([consumer, provider], 'host'))
    const planned = host.diagnostics()
    expect(planned.map(entry => entry.state)).toEqual(['planned', 'planned'])
    expect(planned[1]?.dependencies).toEqual([{ service: 'value', provider: planned[0]?.id }])
    expect(planned[0]?.id).not.toBe(planned[1]?.id)
    expect(planned[0]?.scope).toBe(scope.id)
    const other = new NativeHost(resolveInstallation([{ ...provider }], 'host'))
    expect(other.diagnostics()[0]?.id).not.toBe(planned[0]?.id)
    expect(JSON.stringify(planned)).not.toContain(secret)
    await host.start()
    expect(host.diagnostics().map(entry => entry.state)).toEqual(['ready', 'ready'])
    await host.stop()
    expect(host.diagnostics().map(entry => entry.state)).toEqual(['disposed', 'disposed'])
    expect(host.diagnostics().map(entry => entry.cleanup)).toEqual(['complete', 'complete'])
  })

  it('keeps simultaneous initiators separate and drains work before resource release', async () => {
    const scope = new NativeScope()
    const first = { session: 'first' }
    const second = { session: 'second' }
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let released = false
    const request = { scope, config: {}, plugin: plugin('owner', { resolve: () => (ctx) => {
      ctx.own(() => { released = true })
    } }) }
    const host = new NativeHost(resolveInstallation([request], 'host'))
    await expect(host.run(scope, first, () => 0)).rejects.toThrow('has not started')
    await host.start()
    const firstCall = host.run(scope, first, async (invocation) => {
      entered.resolve(undefined)
      await release.promise
      expect(released).toBe(false)
      return invocation.initiator
    })
    const secondCall = host.run(scope, second, async (invocation) => {
      await release.promise
      return invocation.initiator
    })
    await entered.promise
    const stopping = host.stop()
    await expect(host.run(scope, first, () => 0)).rejects.toThrow('stopped')
    expect(released).toBe(false)
    release.resolve(undefined)
    expect(await Promise.all([firstCall, secondCall])).toEqual([first, second])
    await stopping
    expect(released).toBe(true)
  })

  it('rejects reuse of an installation request even when no service is provided', () => {
    const request = { scope: new NativeScope(), config: {}, plugin: plugin('duplicate') }
    expect(() => resolveInstallation([request, request], 'host')).toThrow('duplicate installation request')
  })

  it('drains an owned callback before releasing resources acquired after its subscription', async () => {
    const scope = new NativeScope()
    const entered = deferred()
    const finish = deferred()
    let released = false
    const request = { scope, config: {}, plugin: plugin('listener', { resolve: () => (ctx) => {
      ctx.on('hold', async () => { entered.resolve(undefined); await finish.promise; expect(released).toBe(false) })
      ctx.own(() => { released = true })
    } }) }
    const host = new NativeHost(resolveInstallation([request], 'host'))
    await host.start()
    const delivery = host.events.serial(scope, 'hold')
    await entered.promise
    const removal = host.remove(request)
    expect(released).toBe(false)
    finish.resolve(undefined)
    await Promise.all([delivery, removal])
    expect(released).toBe(true)
    await host.stop()
  })
  it('reads absent optional services explicitly and activates a selected optional provider first', async () => {
    const scope = new NativeScope()
    const seen: (number | undefined)[] = []
    const consumer = plugin('optional consumer', { optional: ['value'], resolve: () => (ctx) => { seen.push(ctx.optional('value')?.read()) } })
    const provider = plugin('provider', { provides: ['value'], resolve: () => (ctx) => { ctx.provide('value', { read: () => 3 }) } })
    for (const selected of [[consumer], [consumer, provider]]) {
      const host = new NativeHost(resolveInstallation(selected.map(plugin => ({ plugin, scope, config: {} })), 'host'))
      await host.start()
      await host.stop()
    }
    expect(seen).toEqual([undefined, 3])
  })

  it('removes a provider and transitive consumers without releasing an unrelated owner', async () => {
    const scope = new NativeScope()
    const released: string[] = []
    const requests: InstallationRequest[] = [
      plugin('provider', { provides: ['value'], resolve: () => (ctx) => {
        ctx.provide('value', { read: () => 1 })
        ctx.own(() => { released.push('provider') })
      } }),
      plugin('middle', { requires: ['value'], provides: ['other'], resolve: () => (ctx) => {
        ctx.provide('other', ctx.require('value'))
        ctx.own(() => { released.push('middle') })
      } }),
      plugin('leaf', { requires: ['other'], resolve: () => (ctx) => { ctx.own(() => { released.push('leaf') }) } }),
      plugin('independent', { resolve: () => (ctx) => { ctx.own(() => { released.push('independent') }) } }),
    ].map(plugin => ({ plugin, scope, config: {} }))
    const provider = requests[0]
    if (provider === undefined) throw new Error('missing fixture provider')
    const host = new NativeHost(resolveInstallation(requests, 'host'))
    await host.start()
    await host.remove(provider)
    expect(released).toEqual(['leaf', 'middle', 'provider'])
    await host.remove(provider)
    expect(released).toHaveLength(3)
    await host.stop()
    expect(released).toEqual(['leaf', 'middle', 'provider', 'independent'])
  })
  it('validates the whole dependency graph before running configuration or activation', () => {
    let resolved = false
    const scope = new NativeScope()
    const consumer = plugin('consumer', { requires: ['value'], resolve: () => { resolved = true; return () => {} } })
    expect(() => resolveInstallation([{ plugin: consumer, scope, config: {} }], 'host')).toThrow('missing value')
    expect(resolved).toBe(false)
    const provider = plugin('provider', { provides: ['value'], requires: ['other'] })
    const cyclic = plugin('cycle', { provides: ['other'], requires: ['value'] })
    expect(() => resolveInstallation([provider, cyclic].map(plugin => ({ plugin, scope, config: {} })), 'host')).toThrow('dependency cycle')
    expect(() => resolveInstallation([provider, provider].map(plugin => ({ plugin, scope, config: {} })), 'host')).toThrow('duplicate provider')
    expect(() => resolveInstallation([{ plugin: plugin('node-only', { targets: ['host'] }), scope, config: {} }], 'client')).toThrow('does not support client')
    expect(() => resolveInstallation([{ plugin: plugin('future', { apiVersion: 2 }), scope, config: {} }], 'host')).toThrow('unsupported API version')
    expect(() => resolveInstallation([{
      plugin: plugin('invalid config', { resolve: () => { throw new Error('invalid config') } }), scope, config: {},
    }], 'host')).toThrow('invalid config')
  })

  it('waits for providers, selects the nearest scope, and isolates separate realms', async () => {
    const root = new NativeScope()
    const child = new NativeScope(root)
    const isolated = new NativeScope()
    const entered = deferred()
    const proceed = deferred()
    const seen: number[] = []
    const local = plugin('local', { provides: ['value'], resolve: () => async (ctx) => {
      ctx.provide('value', { read: () => 2 })
      entered.resolve(undefined)
      await proceed.promise
    } })
    const parent = plugin('parent', { provides: ['value'], resolve: () => (ctx) =>{  ctx.provide('value', { read: () => 1 }) } })
    const consumer = plugin('consumer', { requires: ['value'], resolve: () => (ctx) => { seen.push(ctx.require('value').read()) } })
    const host = new NativeHost(resolveInstallation([
      { plugin: consumer, scope: child, config: {} }, { plugin: local, scope: child, config: {} },
      { plugin: consumer, scope: root, config: {} }, { plugin: parent, scope: root, config: {} },
    ], 'host'))
    const starting = host.start()
    await entered.promise
    expect(seen).toEqual([])
    proceed.resolve(undefined)
    await starting
    expect(seen).toEqual([2, 1])
    expect(() => resolveInstallation([
      { plugin: parent, scope: root, config: {} }, { plugin: consumer, scope: isolated, config: {} },
    ], 'host')).toThrow('missing value')
    await host.stop()
  })

  it('rolls back failed activation, awaits all cleanup and preserves both failures', async () => {
    const scope = new NativeScope()
    const calls: string[] = []
    const first = plugin('first', { provides: ['value'], resolve: () => (ctx) => {
      ctx.own(() => { calls.push('first') })
      ctx.provide('value', { read: () => 1 })
    } })
    const failed = plugin('failed', { requires: ['value'], resolve: () => (ctx) => {
      ctx.own(() => { calls.push('last'); throw new Error('cleanup') })
      ctx.own(() => { calls.push('first cleanup') })
      throw new Error('startup')
    } })
    const host = new NativeHost(resolveInstallation([failed, first].map(plugin => ({ plugin, scope, config: {} })), 'host'))
    await expect(host.start()).rejects.toThrow('activation and rollback failed')
    expect(calls).toEqual(['first cleanup', 'last', 'first'])
    expect(host.diagnostics().map(entry => [entry.name, entry.state, entry.failure, entry.cleanup])).toEqual([
      ['first', 'disposed', undefined, 'complete'],
      ['failed', 'failed', 'cleanup', 'failed'],
    ])
    await expect(host.stop()).rejects.toThrow('activation and rollback failed')
    expect(calls).toHaveLength(3)
  })

  it('cancels startup and cleans a resource acquired before startup settles', async () => {
    const entered = deferred()
    const proceed = deferred()
    const cleaned: string[] = []
    let context: NativeContext | undefined
    const host = new NativeHost(resolveInstallation([{
      scope: new NativeScope(), config: {}, plugin: plugin('pending', { resolve: () => async (ctx) => {
        context = ctx
        entered.resolve(undefined)
        await proceed.promise
        ctx.own(() => { cleaned.push('late') })
      } }),
    }], 'host'))
    const starting = host.start()
    const failed = expect(starting).rejects.toThrow()
    await entered.promise
    const stopped = host.stop()
    const stoppedFailure = expect(stopped).rejects.toThrow()
    expect(context?.signal.aborted).toBe(true)
    expect(cleaned).toEqual([])
    proceed.resolve(undefined)
    await Promise.all([failed, stoppedFailure])
    expect(cleaned).toEqual(['late'])
    expect(host.stop()).toBe(stopped)
  })

  it('stops dependents before providers and waits for asynchronous disposal', async () => {
    const entered = deferred()
    const proceed = deferred()
    const calls: string[] = []
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      plugin('provider', { provides: ['value'], resolve: () => (ctx) => {
        ctx.provide('value', { read: () => 1 })
        ctx.own(() => { calls.push('provider') })
      } }),
      plugin('consumer', { requires: ['value'], resolve: () => (ctx) => {
        ctx.own(async () => { entered.resolve(undefined); await proceed.promise; calls.push('consumer') })
      } }),
    ].map(plugin => ({ plugin, scope, config: {} })), 'host'))
    await host.start()
    const stopped = host.stop()
    await entered.promise
    expect(calls).toEqual([])
    proceed.resolve(undefined)
    await stopped
    expect(calls).toEqual(['consumer', 'provider'])
  })
})
