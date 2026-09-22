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
