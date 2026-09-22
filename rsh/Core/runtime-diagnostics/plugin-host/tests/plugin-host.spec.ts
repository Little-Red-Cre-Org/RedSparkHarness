import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import RshPluginHost, { adaptCordisPlugin, mountCordisPlugin } from '../src/index.ts'

const descriptor = {
  packageName: '@deepseek-ai/dsh-example-plugin',
  apiVersion: 1 as const,
  role: 'consumer' as const,
  capability: 'example',
}

let loaderRoot: string | undefined
let loaderContext: Context | undefined

afterEach(async () => {
  await loaderContext?.fiber.dispose()
  loaderContext = undefined
  if (loaderRoot !== undefined) await rm(loaderRoot, { recursive: true, force: true })
  loaderRoot = undefined
})

describe('RshPluginHost', () => {
  it('reserves descriptors and releases them through the returned disposer', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const unregister = ctx.pluginHost.register(descriptor)
    expect(ctx.pluginHost.entries()).toEqual([descriptor])
    expect(() => ctx.pluginHost.register(descriptor)).toThrow('already registered')
    unregister()
    expect(ctx.pluginHost.entries()).toEqual([])
  })

  it('rejects unsupported descriptors before reserving their identity', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    expect(() => ctx.pluginHost.register({ ...descriptor, apiVersion: 2 as 1 })).toThrow('unsupported runtime API 2')
    expect(ctx.pluginHost.entries()).toEqual([])
  })

  it('rejects invalid package names, capabilities, and roles', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    for (const packageName of ['', ' leading', 'two words']) {
      expect(() => ctx.pluginHost.register({ ...descriptor, packageName })).toThrow('packageName')
    }
    for (const capability of ['', ' trailing ', 'two words']) {
      expect(() => ctx.pluginHost.register({ ...descriptor, capability })).toThrow('invalid')
    }
    expect(() => ctx.pluginHost.register({ ...descriptor, role: 'unknown' as 'consumer' })).toThrow('unsupported role unknown')
    expect(ctx.pluginHost.entries()).toEqual([])
  })

  it('reports a missing host for both entry forms', async () => {
    const ctx = new Context()
    const adapter = adaptCordisPlugin(descriptor, () => {})
    await expect(adapter.apply(ctx, {})).rejects.toThrow('requires ctx.pluginHost')
    await expect(mountCordisPlugin(ctx, descriptor, () => {})).rejects.toThrow('requires ctx.pluginHost')
  })

  it('preserves wrapped plugin metadata and resolved default config', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    let seen: { value: string } | undefined
    const Config = z.object({ value: z.string().default('default-value') })
    const legacy = {
      name: 'legacy-defaults',
      Config,
      inject: [] as const,
      provide: 'legacyDefaults',
      intercept: { legacyDefaults: true },
      apply(_ctx: Context, config: { value: string }) {
        seen = config
      },
    }
    const adapter = adaptCordisPlugin(descriptor, legacy)
    expect(adapter.name).toBe('legacy-defaults')
    expect(adapter.Config).toBe(Config)
    expect(adapter.inject).toEqual(['pluginHost'])
    expect(adapter.provide).toBe('legacyDefaults')
    expect(adapter.intercept).toEqual({ legacyDefaults: true })
    const fiber = await ctx.plugin(adapter)
    expect(seen).toEqual({ value: 'default-value' })
    await fiber.dispose()
    expect(ctx.pluginHost.get(descriptor.packageName)).toBeUndefined()
  })

  it('propagates child startup failure through the adapter fiber and releases its descriptor', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const adapter = adaptCordisPlugin(descriptor, {
      name: 'legacy-failure',
      apply() {
        throw new Error('legacy child failure')
      },
    })
    await expect(ctx.plugin(adapter)).rejects.toThrow('legacy child failure')
    expect(ctx.pluginHost.entries()).toEqual([])
  })

  it('fails a real Loader row on child startup failure without leaving a descriptor', async () => {
    loaderRoot = await mkdtemp(join(tmpdir(), 'dsh-plugin-host-loader-'))
    const configPath = join(loaderRoot, 'cordis.yml')
    await writeFile(configPath, [
      "- id: 'plugin-host'",
      "  name: '@test/plugin-host'",
      "- id: 'failing-adapter'",
      "  name: '@test/failing-adapter'",
      '',
    ].join('\n'))
    loaderContext = new Context()
    loaderContext.baseUrl = pathToFileURL(loaderRoot).href + '/'
    await loaderContext.plugin(Loader)
    loaderContext.loader.builtins.include = Include
    const adapter = adaptCordisPlugin(descriptor, {
      name: 'legacy-loader-failure',
      apply() {
        throw new Error('legacy Loader child failure')
      },
    })
    loaderContext.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@test/plugin-host') return RshPluginHost
        if (specifier === '@test/failing-adapter') return adapter
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof loaderContext.loader.internal>
    await expect(loaderContext.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })).rejects.toThrow('legacy Loader child failure')
    expect(loaderContext.get('pluginHost')).toBeUndefined()
  })

  it('waits for an HMR adapter owner to finish asynchronous child teardown before replacement', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    let beginTeardown!: () => void
    let finishTeardown!: () => void
    const teardownStarted = new Promise<void>((resolve) => { beginTeardown = resolve })
    const teardownGate = new Promise<void>((resolve) => { finishTeardown = resolve })
    const first = adaptCordisPlugin(descriptor, (child: Context) => {
      child.effect(() => async () => {
        beginTeardown()
        await teardownGate
      })
    })
    let replacementStarts = 0
    const second = adaptCordisPlugin(descriptor, () => { replacementStarts++ })
    const oldFiber = await ctx.plugin(first)
    try {
      ctx.registry.delete(first)
      const replacement = ctx.plugin(second)
      const oldTeardown = oldFiber.inertia
      await teardownStarted
      expect(ctx.pluginHost.get(descriptor.packageName)).toBe(descriptor)
      expect(replacementStarts).toBe(0)
      finishTeardown()
      await oldTeardown
      await replacement
      expect(replacementStarts).toBe(1)
      expect(ctx.pluginHost.entries()).toEqual([descriptor])
      await replacement.dispose()
      expect(ctx.pluginHost.entries()).toEqual([])
    } finally {
      finishTeardown()
      await ctx.fiber.dispose()
    }
  })

  it('keeps rejecting duplicate active adapter owners', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const first = await ctx.plugin(adaptCordisPlugin(descriptor, () => {}))
    try {
      await expect(ctx.plugin(adaptCordisPlugin(descriptor, () => {}))).rejects.toThrow('already registered')
      expect(ctx.pluginHost.entries()).toEqual([descriptor])
    } finally {
      await first.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('cancels a waiting HMR adapter without starting its child', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    let beginTeardown!: () => void
    let finishTeardown!: () => void
    const teardownStarted = new Promise<void>((resolve) => { beginTeardown = resolve })
    const teardownGate = new Promise<void>((resolve) => { finishTeardown = resolve })
    const first = adaptCordisPlugin(descriptor, (child: Context) => {
      child.effect(() => async () => {
        beginTeardown()
        await teardownGate
      })
    })
    let replacementStarts = 0
    const oldFiber = await ctx.plugin(first)
    try {
      ctx.registry.delete(first)
      const replacement = ctx.plugin(adaptCordisPlugin(descriptor, () => { replacementStarts++ }))
      await teardownStarted
      await replacement.dispose()
      finishTeardown()
      await oldFiber.inertia
      await replacement
      expect(replacementStarts).toBe(0)
      expect(ctx.pluginHost.entries()).toEqual([])
    } finally {
      finishTeardown()
      await ctx.fiber.dispose()
    }
  })

  it('holds HMR replacement through teardown after a repeated child disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    let beginTeardown!: () => void
    let finishTeardown!: () => void
    const teardownStarted = new Promise<void>((resolve) => { beginTeardown = resolve })
    const teardownGate = new Promise<void>((resolve) => { finishTeardown = resolve })
    let childFiber: Context['fiber'] | undefined
    const first = adaptCordisPlugin(descriptor, (child: Context) => {
      childFiber = child.fiber
      child.effect(() => async () => {
        beginTeardown()
        await teardownGate
      })
    })
    let replacementStarts = 0
    await ctx.plugin(first)
    try {
      const disposingChild = childFiber!.dispose()
      await teardownStarted
      ctx.registry.delete(first)
      const replacement = ctx.plugin(adaptCordisPlugin(descriptor, () => { replacementStarts++ }))
      expect(ctx.pluginHost.get(descriptor.packageName)).toBe(descriptor)
      expect(replacementStarts).toBe(0)
      finishTeardown()
      await disposingChild
      await replacement
      expect(replacementStarts).toBe(1)
      expect(ctx.pluginHost.entries()).toEqual([descriptor])
    } finally {
      finishTeardown()
      await ctx.fiber.dispose()
    }
  })

  it('settles an adapter disposed during child startup before HMR replacement', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    let beginStartup!: () => void
    let finishStartup!: () => void
    const startupStarted = new Promise<void>((resolve) => { beginStartup = resolve })
    const startupGate = new Promise<void>((resolve) => { finishStartup = resolve })
    let beginTeardown!: () => void
    let finishTeardown!: () => void
    const teardownStarted = new Promise<void>((resolve) => { beginTeardown = resolve })
    const teardownGate = new Promise<void>((resolve) => { finishTeardown = resolve })
    const first = adaptCordisPlugin(descriptor, async (child: Context) => {
      child.effect(() => async () => {
        beginTeardown()
        await teardownGate
      })
      beginStartup()
      await startupGate
    })
    try {
      const starting = ctx.plugin(first)
      await startupStarted
      ctx.registry.delete(first)
      const replacement = ctx.plugin(adaptCordisPlugin(descriptor, () => {}))
      finishStartup()
      await teardownStarted
      expect(ctx.pluginHost.get(descriptor.packageName)).toBe(descriptor)
      finishTeardown()
      await starting
      await replacement
      expect(ctx.pluginHost.entries()).toEqual([descriptor])
    } finally {
      finishStartup()
      finishTeardown()
      await ctx.fiber.dispose()
    }
  })

  it('allows only one concurrent HMR replacement to claim a package name', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    let beginTeardown!: () => void
    let finishTeardown!: () => void
    const teardownStarted = new Promise<void>((resolve) => { beginTeardown = resolve })
    const teardownGate = new Promise<void>((resolve) => { finishTeardown = resolve })
    const first = adaptCordisPlugin(descriptor, (child: Context) => {
      child.effect(() => async () => {
        beginTeardown()
        await teardownGate
      })
    })
    let replacementStarts = 0
    await ctx.plugin(first)
    try {
      ctx.registry.delete(first)
      const replacements = [1, 2].map(() => ctx.plugin(adaptCordisPlugin(descriptor, () => { replacementStarts++ })))
      await teardownStarted
      expect(replacementStarts).toBe(0)
      finishTeardown()
      const outcomes = await Promise.allSettled(replacements)
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter(result => result.status === 'rejected').map(result => String(result.reason)))
        .toEqual([expect.stringContaining('already registered')])
      expect(replacementStarts).toBe(1)
      expect(ctx.pluginHost.entries()).toEqual([descriptor])
    } finally {
      finishTeardown()
      await ctx.fiber.dispose()
    }
  })

  it('keeps package names in order and merges object-style injections', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const second = { ...descriptor, packageName: '@example/z' }
    const first = { ...descriptor, packageName: '@example/a' }
    const releaseSecond = ctx.pluginHost.register(second)
    const releaseFirst = ctx.pluginHost.register(first)
    expect(ctx.pluginHost.entries()).toEqual([first, second])
    const adapter = adaptCordisPlugin({ ...descriptor, packageName: '@example/object' }, {
      inject: { requiredService: undefined },
      apply() {},
    })
    expect(adapter.inject).toEqual({ pluginHost: undefined, requiredService: undefined })
    releaseFirst()
    releaseSecond()
  })

  it('keeps a successor when the previous disposer runs again', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const unregister = ctx.pluginHost.register(descriptor)
    unregister()
    const successor = { ...descriptor, capability: 'successor' }
    const releaseSuccessor = ctx.pluginHost.register(successor)
    unregister()
    expect(ctx.pluginHost.get(descriptor.packageName)).toBe(successor)
    releaseSuccessor()
    expect(ctx.pluginHost.entries()).toEqual([])
  })

  it('releases descriptors when a direct mount is disposed through its helper', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const mounted = await mountCordisPlugin(ctx, descriptor, () => {})
    await mounted.dispose()
    expect(ctx.pluginHost.get(descriptor.packageName)).toBeUndefined()
  })

  it('preserves child metadata when the original plugin declares no injections', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const adapter = adaptCordisPlugin(descriptor, { apply() {} })
    expect(adapter.inject).toEqual(['pluginHost'])
    const fiber = await ctx.plugin(adapter)
    await fiber.dispose()
  })

  it('releases a descriptor when its direct fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const mounted = await mountCordisPlugin(ctx, descriptor, () => {})
    await mounted.fiber.dispose()
    expect(ctx.pluginHost.get(descriptor.packageName)).toBeUndefined()
    await expect(mountCordisPlugin(ctx, descriptor, () => {})).resolves.toMatchObject({ descriptor })
  })

  it('releases a descriptor when its direct mount parent is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    const parent = await ctx.plugin(Object.assign(() => {}, { inject: ['pluginHost'] }))
    await mountCordisPlugin(parent.ctx, descriptor, () => {})
    await parent.dispose()
    expect(ctx.pluginHost.get(descriptor.packageName)).toBeUndefined()
  })

  it('releases a descriptor when a direct legacy mount fails', async () => {
    const ctx = new Context()
    await ctx.plugin(RshPluginHost)
    await expect(mountCordisPlugin(ctx, descriptor, () => { throw new Error('legacy failure') })).rejects.toThrow('legacy failure')
    expect(ctx.pluginHost.entries()).toEqual([])
  })
})
