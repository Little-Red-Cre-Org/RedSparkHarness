/** Native-owned activation, rollback, and removal of the optional Cordis runtime. */
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { expect, it } from 'vitest'
import { plugin, validateCordisManifest, type CompatDshRuntime } from '../src/native.ts'

it('rejects unknown host config and unsupported Cordis versions before activation', () => {
  expect(() => plugin.resolve({ enabled: true })).toThrow('configuration must be empty')
  expect(() => { validateCordisManifest({ version: '3.9.0' }) }).toThrow('unsupported Cordis version')
  expect(() => { validateCordisManifest({ version: 4 }) }).toThrow('unsupported Cordis version')
  expect(() => { validateCordisManifest({ version: '4.0.2' }) }).not.toThrow()
})

it('mounts only allowlisted DSH plugins and awaits their removal without stopping other mounts', async () => {
  const scope = new NativeScope()
  let runtime: CompatDshRuntime | undefined
  let disposeFirst: (() => Promise<void>) | undefined
  const mountedPlugin: NativePlugin = {
    apiVersion: 1, name: 'compat-mount-consumer', targets: ['host'], requires: ['compatDshRuntime'], provides: [],
    resolve: () => async (context) => {
      const compat = context.require('compatDshRuntime')
      const mount = compat.mount('@deepseek-ai/dsh-fs-local', (legacy) => {
        legacy.provide('compatTest', 'mounted')
      })
      const second = compat.mount('@deepseek-ai/dsh-fs-sandbox', (legacy) => {
        legacy.provide('compatSecond', 'mounted')
      })
      context.own(() => mount.dispose())
      context.own(() => second.dispose())
      await mount.ready
      await second.ready
      disposeFirst = () => mount.dispose()
      runtime = compat
    },
  }
  const install = { plugin: mountedPlugin, scope, config: undefined }
  const selected = new NativeHost(resolveInstallation([
    { plugin, scope, config: undefined }, install,
  ], 'host'))
  try {
    await selected.start()
    const compat = runtime
    if (compat === undefined) throw new Error('missing compatibility runtime')
    expect(compat.context.get('compatTest')).toBe('mounted')
    expect(compat.context.get('compatSecond')).toBe('mounted')
    expect(() => compat.mount('@third-party/unknown', () => {})).toThrow('unsupported plugin')
    const releaseFirst = disposeFirst
    if (releaseFirst === undefined) throw new Error('missing first mount disposer')
    await releaseFirst()
    expect(compat.context.get('compatTest')).toBeUndefined()
    expect(compat.context.get('compatSecond')).toBe('mounted')
    await selected.remove(install)
    expect(compat.context.get('compatSecond')).toBeUndefined()
    expect(selected.diagnostics().some(entry => entry.name === plugin.name && entry.state === 'ready')).toBe(true)
  } finally {
    await selected.stop()
  }
})

it('rolls back a partially activated legacy plugin and releases its Cordis resources', async () => {
  const scope = new NativeScope()
  let disposed = 0
  const failing: NativePlugin = {
    apiVersion: 1, name: 'compat-mount-failure', targets: ['host'], requires: ['compatDshRuntime'], provides: [],
    resolve: () => async (context) => {
      const compat = context.require('compatDshRuntime')
      const mount = compat.mount('@deepseek-ai/dsh-fs-observation-policy', async (legacy) => {
        legacy.effect(() => () => { disposed += 1 })
        await Promise.resolve()
        throw new Error('fixture activation failure')
      })
      context.own(() => mount.dispose())
      await mount.ready
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: undefined }, { plugin: failing, scope, config: undefined },
  ], 'host'))
  let failure: unknown
  try { await host.start() } catch (error) { failure = error }
  expect(failure).toMatchObject({ message: 'fixture activation failure' })
  expect(disposed).toBe(1)
  await expect(host.stop()).rejects.toMatchObject({ message: 'fixture activation failure' })
})
