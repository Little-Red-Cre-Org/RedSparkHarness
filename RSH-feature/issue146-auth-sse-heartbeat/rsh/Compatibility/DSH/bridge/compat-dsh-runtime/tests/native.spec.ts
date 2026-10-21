/** Native-owned activation, rollback, and removal of the optional Cordis runtime. */
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { expect, it } from 'vitest'
import { plugin, validateCordisManifest, validateLoaderManifest, type CompatDshRuntime } from '../src/native.ts'

it('rejects unknown host config and unsupported Cordis versions before activation', () => {
  expect(() => plugin.resolve({ enabled: true })).toThrow('configuration must be empty')
  const cordisManifest = { name: '@deepseek-ai/cordis', version: '4.0.2' }
  for (const version of ['3.9.0', 4, '4.foo', '4.1.0', '4.0.2-beta.1']) {
    expect(() => { validateCordisManifest({ ...cordisManifest, version }) }).toThrow('unsupported @deepseek-ai/cordis version')
  }
  expect(() => { validateCordisManifest(cordisManifest) }).not.toThrow()
  expect(() => { validateCordisManifest({ ...cordisManifest, name: '@deepseek-ai/other' }) }).toThrow('package name')
  const loaderManifest = { name: '@deepseek-ai/cordis-plugin-loader', version: '1.0.3' }
  expect(() => { validateLoaderManifest(loaderManifest) }).not.toThrow()
  expect(() => { validateLoaderManifest({ ...loaderManifest, version: '1.0.4' }) }).toThrow('unsupported @deepseek-ai/cordis-plugin-loader version')
})

it('mounts only allowlisted DSH plugins and awaits their removal without stopping other mounts', async () => {
  const scope = new NativeScope()
  let runtime: CompatDshRuntime | undefined
  let disposeFirst: (() => Promise<void>) | undefined
  let signalTeardownStarted: (() => void) | undefined
  let finishTeardown: (() => void) | undefined
  let markFirstDisposed: (() => void) | undefined
  let firstCleanupCompleted = false
  const teardownStarted = new Promise<void>((resolve) => { signalTeardownStarted = resolve })
  const teardownGate = new Promise<void>((resolve) => { finishTeardown = resolve })
  const firstDisposed = new Promise<void>((resolve) => { markFirstDisposed = resolve })
  const mountedPlugin: NativePlugin = {
    apiVersion: 1, name: 'compat-mount-consumer', targets: ['host'], requires: ['compatDshRuntime'], provides: [],
    resolve: () => async (context) => {
      const compat = context.require('compatDshRuntime')
      const mount = compat.mount('@deepseek-ai/dsh-fs-local', (legacy) => {
        legacy.provide('compatTest', 'mounted')
        legacy.fiber.effect(() => async () => {
          signalTeardownStarted?.()
          await teardownGate
          firstCleanupCompleted = true
          markFirstDisposed?.()
        })
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
    const target = {}
    const observation = { kind: 'present' }
    const actor = {}
    const scope = {}
    const secondScope = {}
    const nestedObservation = { kind: 'absent' }
    let forwards = 0
    compat.forwardFsObserved(scope, target, observation, actor, () => {
      forwards += 1
      compat.forwardFsObserved(scope, target, observation, actor, () => { forwards += 100 })
      compat.forwardFsObserved(scope, target, nestedObservation, actor, () => { forwards += 10 })
      compat.forwardFsObserved(secondScope, target, observation, actor, () => { forwards += 1_000 })
    })
    expect(forwards).toBe(1_011)
    compat.forwardFsObserved(scope, target, nestedObservation, actor, () => {
      forwards += 100
      compat.forwardFsObserved(scope, target, nestedObservation, actor, () => { forwards += 1_000 })
    })
    expect(forwards).toBe(1_111)
    expect(() => { compat.forwardFsObserved(scope, target, observation, actor, () => { throw new Error('observer failed') }) })
      .toThrow('observer failed')
    compat.forwardFsObserved(scope, target, observation, actor, () => { forwards += 1 })
    expect(forwards).toBe(1_112)
    expect(() => compat.mount('@third-party/unknown', () => {})).toThrow('unsupported plugin')
    const releaseFirst = disposeFirst
    if (releaseFirst === undefined) throw new Error('missing first mount disposer')
    const firstRelease = releaseFirst()
    await teardownStarted
    expect(firstCleanupCompleted).toBe(false)
    finishTeardown?.()
    await firstRelease
    await firstDisposed
    expect(firstCleanupCompleted).toBe(true)
    expect(compat.context.get('compatTest')).toBeUndefined()
    expect(compat.context.get('compatSecond')).toBe('mounted')
    await selected.remove(install)
    expect(compat.context.get('compatSecond')).toBeUndefined()
    expect(selected.diagnostics().some(entry => entry.name === plugin.name && entry.state === 'ready')).toBe(true)
  } finally {
    await selected.stop()
  }
  expect(runtime?.context.fiber.getEffects()).toEqual([])
  expect(runtime?.context.get('compatSecond')).toBeUndefined()
})

it('rolls back a partially activated legacy plugin and releases its Cordis resources', async () => {
  const scope = new NativeScope()
  let disposed = 0
  let runtime: CompatDshRuntime | undefined
  let failedError: unknown
  const failing: NativePlugin = {
    apiVersion: 1, name: 'compat-mount-failure', targets: ['host'], requires: ['compatDshRuntime'], provides: [],
    resolve: () => async (context) => {
      const compat = context.require('compatDshRuntime')
      const mount = compat.mount('@deepseek-ai/dsh-fs-observation-policy', async (legacy) => {
        legacy.effect(() => () => { disposed += 1 })
        await Promise.resolve()
        throw new Error('fixture activation failure')
      })
      const survivor = compat.mount('@deepseek-ai/dsh-fs-local', (legacy) => {
        legacy.provide('compatSurvivor', 'mounted')
      })
      context.own(() => mount.dispose())
      context.own(() => survivor.dispose())
      failedError = await mount.ready.then(() => undefined, (error: unknown) => error)
      await survivor.ready
      runtime = compat
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: undefined }, { plugin: failing, scope, config: undefined },
  ], 'host'))
  await host.start()
  expect(failedError).toMatchObject({ cause: { message: 'fixture activation failure' } })
  expect(disposed).toBe(1)
  if (runtime === undefined) throw new Error('missing compatibility runtime')
  expect(runtime.context.loader.store['@deepseek-ai/dsh-fs-observation-policy']).toBeUndefined()
  expect(runtime.context.pluginHost.get('@deepseek-ai/dsh-fs-observation-policy')).toBeUndefined()
  expect(runtime.context.get('compatSurvivor')).toBe('mounted')
  await runtime.update('@deepseek-ai/dsh-fs-local', { enabledForTest: true })
  await runtime.setEnabled('@deepseek-ai/dsh-fs-local', false)
  expect(runtime.context.get('compatSurvivor')).toBeUndefined()
  await runtime.setEnabled('@deepseek-ai/dsh-fs-local', true)
  expect(runtime.context.get('compatSurvivor')).toBe('mounted')
  await runtime.remove('@deepseek-ai/dsh-fs-local')
  expect(runtime.context.get('compatSurvivor')).toBeUndefined()
  await host.stop()
})

it.each(['suspend', 'resume'] as const)('recovers mount lifecycle after participant %s failure', async (phase) => {
  const scope = new NativeScope()
  let runtime: CompatDshRuntime | undefined
  const capture: NativePlugin = {
    apiVersion: 1,
    name: 'compat-lifecycle-capture',
    targets: ['host'],
    requires: ['compatDshRuntime'],
    provides: [],
    resolve: () => (native) => { runtime = native.require('compatDshRuntime') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: undefined }, { plugin: capture, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (runtime === undefined) throw new Error('missing compatibility runtime')
  const name = '@deepseek-ai/dsh-fs-local'
  let rejectResume = phase === 'resume'
  let failCleanupSuspend = false
  const unregister = runtime.registerLifecycleParticipant({
    suspend: async () => {
      if (phase === 'suspend' || failCleanupSuspend) throw new Error('fixture participant suspend failure')
    },
    resume: async () => {
      if (rejectResume) {
        rejectResume = false
        failCleanupSuspend = true
        throw new Error('fixture participant resume failure')
      }
    },
  })
  const mount = runtime.mount(name, (legacy) => { legacy.provide('compatRecovery', 'mounted') })
  try {
    const activationFailure: unknown = await mount.ready.then(() => undefined, (error: unknown) => error)
    if (phase === 'suspend') {
      expect(activationFailure).toMatchObject({ message: 'fixture participant suspend failure' })
    } else {
      if (!(activationFailure instanceof AggregateError)) throw new Error('missing cleanup failure aggregate')
      expect(activationFailure.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'fixture participant resume failure' }),
      ]))
    }
    expect(runtime.hasEntry(name)).toBe(phase === 'resume')
    expect(runtime.isEnabled(name)).toBe(phase === 'resume')
    expect(runtime.context.loader.store[name] !== undefined).toBe(phase === 'resume')
    expect(runtime.context.loader.builtins[name] !== undefined).toBe(phase === 'resume')
    expect(runtime.context.get('compatRecovery')).toBe(phase === 'resume' ? 'mounted' : undefined)
    unregister()
    await mount.dispose()
    expect(runtime.hasEntry(name)).toBe(false)
    expect(runtime.isEnabled(name)).toBe(false)
    expect(runtime.context.loader.store[name]).toBeUndefined()
    expect(runtime.context.loader.builtins[name]).toBeUndefined()
    expect(runtime.context.get('compatRecovery')).toBeUndefined()
    const retry = runtime.mount(name, (legacy) => { legacy.provide('compatRecovery', 'mounted') })
    await retry.ready
    expect(runtime.context.get('compatRecovery')).toBe('mounted')
    let rejectSuspend = true
    const unregisterRejector = runtime.registerLifecycleParticipant({
      suspend: async () => {
        if (rejectSuspend) {
          rejectSuspend = false
          throw new Error('fixture remove suspend failure')
        }
      },
      resume: async () => {},
    })
    await expect(runtime.remove(name)).rejects.toThrow('fixture remove suspend failure')
    expect(runtime.hasEntry(name)).toBe(true)
    expect(runtime.isEnabled(name)).toBe(true)
    expect(runtime.context.loader.store[name]).toBeDefined()
    expect(runtime.context.get('compatRecovery')).toBe('mounted')
    unregisterRejector()
    await runtime.setEnabled(name, false)
    expect(runtime.isEnabled(name)).toBe(false)
    expect(runtime.context.get('compatRecovery')).toBeUndefined()
    await runtime.setEnabled(name, true)
    expect(runtime.context.get('compatRecovery')).toBe('mounted')
    await retry.dispose()
    expect(runtime.context.get('compatRecovery')).toBeUndefined()
  } finally {
    unregister()
    await host.stop()
  }
})
