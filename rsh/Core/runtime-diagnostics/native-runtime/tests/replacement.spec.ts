/** Installation replacement with deterministic work and resource handoff barriers. */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type InstallationRequest, type NativePlugin } from '../src/index.ts'

declare module '../src/index.ts' {
  interface NativeServices {
    replacementValue: { read(): number }
  }
}

function plugin(name: string, overrides: Partial<NativePlugin> = {}): NativePlugin {
  return { name, apiVersion: 1, targets: ['host', 'client'], requires: [], provides: [], resolve: () => () => {}, ...overrides }
}

function request(scope: NativeScope, selected: NativePlugin): InstallationRequest {
  return { scope, plugin: selected, config: undefined }
}

describe('native composition replacement', () => {
  it('drains affected work and asynchronous disposal before activating successors while preserving independent owners', async () => {
    const scope = new NativeScope()
    const called = Promise.withResolvers<undefined>()
    const cancelled = Promise.withResolvers<undefined>()
    const finishWork = Promise.withResolvers<undefined>()
    const disposing = Promise.withResolvers<undefined>()
    const finishDisposal = Promise.withResolvers<undefined>()
    const unaffectedFinish = Promise.withResolvers<undefined>()
    const order: string[] = []
    const values: number[] = []
    const previous = request(scope, plugin('previous', { provides: ['replacementValue'], resolve: () => (ctx) => {
      ctx.provide('replacementValue', { read: () => 1 })
      ctx.own(() => { order.push('previous disposed') })
    } }))
    const consumer = request(scope, plugin('consumer', { requires: ['replacementValue'], resolve: () => (ctx) => {
      values.push(ctx.require('replacementValue').read())
      ctx.own(async () => {
        disposing.resolve(undefined)
        await finishDisposal.promise
        order.push('consumer disposed')
      })
    } }))
    const independent = request(scope, plugin('independent'))
    const next = request(scope, plugin('next', { provides: ['replacementValue'], resolve: () => (ctx) => {
      order.push('next active')
      ctx.provide('replacementValue', { read: () => 2 })
    } }))
    const host = new NativeHost(resolveInstallation([previous, consumer, independent], 'host'))
    await host.start()
    const independentId = host.diagnostics().find(entry => entry.name === 'independent')?.id
    const work = host.runOwned(consumer, {}, async ({ signal }) => {
      signal.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
      called.resolve(undefined)
      await finishWork.promise
      expect(order).toEqual([])
      order.push('work completed')
    })
    const unaffected = host.runOwned(independent, {}, async ({ signal }) => {
      await unaffectedFinish.promise
      expect(signal.aborted).toBe(false)
    })
    await called.promise
    const replacing = host.replace(resolveInstallation([next, consumer, independent], 'host'))
    try {
      await expect(host.run(scope, {}, () => 0)).rejects.toThrow('changing installations')
      await cancelled.promise
      expect(order).toEqual([])
      finishWork.resolve(undefined)
      await work
      await disposing.promise
      expect(order).toEqual(['work completed'])
      finishDisposal.resolve(undefined)
      await replacing
      expect(order).toEqual(['work completed', 'consumer disposed', 'previous disposed', 'next active'])
      expect(values).toEqual([1, 2])
      expect(host.diagnostics().filter(entry => entry.name === 'independent').map(entry => entry.id)).toEqual([independentId])
      await expect(host.runOwned(previous, {}, () => 0)).rejects.toThrow('not ready')
      await expect(host.runOwned(consumer, {}, () => 3)).resolves.toBe(3)
      unaffectedFinish.resolve(undefined)
      await unaffected
    } finally {
      finishWork.resolve(undefined)
      finishDisposal.resolve(undefined)
      unaffectedFinish.resolve(undefined)
      await Promise.allSettled([work, unaffected, replacing])
      await host.stop()
    }
  })

  it('reactivates optional consumers when a nearer provider appears or disappears', async () => {
    const root = new NativeScope()
    const child = new NativeScope(root)
    const values: (number | undefined)[] = []
    const provider = (scope: NativeScope, value: number) => request(scope, plugin(`provider ${String(value)}`, {
      provides: ['replacementValue'], resolve: () => (ctx) => { ctx.provide('replacementValue', { read: () => value }) },
    }))
    const parent = provider(root, 1)
    const local = provider(child, 2)
    const consumer = request(child, plugin('optional', { optional: ['replacementValue'], resolve: () => (ctx) => {
      values.push(ctx.optional('replacementValue')?.read())
    } }))
    const host = new NativeHost(resolveInstallation([consumer, parent], 'host'))
    try {
      await host.start()
      await host.replace(resolveInstallation([consumer, parent, local], 'host'))
      await host.replace(resolveInstallation([consumer, parent], 'host'))
      await host.replace(resolveInstallation([consumer], 'host'))
      expect(values).toEqual([1, 2, 1, undefined])
    } finally { await host.stop() }
  })

  it('keeps the current composition active after resolution or target refusal and a no-op replacement', async () => {
    const scope = new NativeScope()
    let releases = 0
    const selected = request(scope, plugin('selected', { resolve: () => (ctx) => { ctx.own(() => { releases++ }) } }))
    const host = new NativeHost(resolveInstallation([selected], 'host'))
    try {
      await host.start()
      const id = host.diagnostics()[0]?.id
      expect(() => resolveInstallation([request(scope, plugin('invalid', {
        resolve: () => { throw new Error('invalid config') },
      }))], 'host')).toThrow('invalid config')
      await expect(host.replace(resolveInstallation([selected], 'client'))).rejects.toThrow('target differs')
      await host.replace(resolveInstallation([selected], 'host'))
      await expect(host.runOwned(selected, {}, () => 7)).resolves.toBe(7)
      expect(host.diagnostics()[0]?.id).toBe(id)
      expect(releases).toBe(0)
    } finally { await host.stop() }
    expect(releases).toBe(1)
  })

  it('stops without activating a successor when cleanup fails and never restores the old owner', async () => {
    const scope = new NativeScope()
    let activations = 0
    let releases = 0
    const old = request(scope, plugin('old', { resolve: () => (ctx) => {
      ctx.own(() => { throw new Error('cleanup failed') })
    } }))
    const independent = request(scope, plugin('independent', { resolve: () => (ctx) => { ctx.own(() => { releases++ }) } }))
    const next = request(scope, plugin('next', { resolve: () => () => { activations++ } }))
    const host = new NativeHost(resolveInstallation([old, independent], 'host'))
    await host.start()
    await expect(host.replace(resolveInstallation([next, independent], 'host'))).rejects.toThrow('composition cleanup failed')
    expect(activations).toBe(0)
    expect(releases).toBe(1)
    expect(host.diagnostics().find(entry => entry.name === 'old')?.cleanup).toBe('failed')
    await expect(host.run(scope, {}, () => 0)).rejects.toThrow('stopped')
    await host.stop()
  })

  it('cleans a partially activated successor and every retained owner when replacement activation fails', async () => {
    const scope = new NativeScope()
    const released: string[] = []
    const old = request(scope, plugin('old', { resolve: () => (ctx) => { ctx.own(() => { released.push('old') }) } }))
    const retained = request(scope, plugin('retained', { resolve: () => (ctx) => { ctx.own(() => { released.push('retained') }) } }))
    const failed = request(scope, plugin('failed', { resolve: () => (ctx) => {
      ctx.own(() => { released.push('partial') })
      throw new Error('replacement activation')
    } }))
    const host = new NativeHost(resolveInstallation([old, retained], 'host'))
    await host.start()
    await expect(host.replace(resolveInstallation([failed, retained], 'host'))).rejects.toThrow('replacement activation')
    expect(released).toEqual(['old', 'partial', 'retained'])
    expect(host.diagnostics().find(entry => entry.name === 'failed')?.failure).toBe('activation')
    await expect(host.run(scope, {}, () => 0)).rejects.toThrow('stopped')
    await host.stop()
  })

  it('awaits replacement teardown during stop and does not publish a cancelled successor', async () => {
    const scope = new NativeScope()
    const disposing = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    let activations = 0
    const old = request(scope, plugin('old', { resolve: () => (ctx) => { ctx.own(async () => {
      disposing.resolve(undefined)
      await finish.promise
    }) } }))
    const next = request(scope, plugin('next', { resolve: () => () => { activations++ } }))
    const host = new NativeHost(resolveInstallation([old], 'host'))
    await host.start()
    const replacing = host.replace(resolveInstallation([next], 'host'))
    const rejected = expect(replacing).rejects.toThrow()
    await disposing.promise
    const stopping = host.stop()
    try {
      finish.resolve(undefined)
      await Promise.all([rejected, stopping])
      expect(activations).toBe(0)
      expect(host.diagnostics().every(entry => entry.cleanup === 'complete')).toBe(true)
    } finally {
      finish.resolve(undefined)
      await Promise.allSettled([replacing, stopping])
    }
  })

  it('serializes competing replacement plans and preserves the consumer request identity', async () => {
    const scope = new NativeScope()
    const values: number[] = []
    const provider = (value: number) => request(scope, plugin(`value ${String(value)}`, {
      provides: ['replacementValue'], resolve: () => (ctx) => { ctx.provide('replacementValue', { read: () => value }) },
    }))
    const consumer = request(scope, plugin('consumer', { requires: ['replacementValue'], resolve: () => (ctx) => {
      values.push(ctx.require('replacementValue').read())
    } }))
    const host = new NativeHost(resolveInstallation([provider(1), consumer], 'host'))
    try {
      await host.start()
      await Promise.all([
        host.replace(resolveInstallation([provider(2), consumer], 'host')),
        host.replace(resolveInstallation([provider(3), consumer], 'host')),
      ])
      expect(values).toEqual([1, 2, 3])
      await expect(host.runOwned(consumer, {}, () => 0)).resolves.toBe(0)
    } finally { await host.stop() }
  })
})
