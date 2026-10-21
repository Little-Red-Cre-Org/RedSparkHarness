import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { credentialKey, credentialRef, type CredentialRecord, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as authorizationPlugin, type NativeAuthorization } from '../../authorization/src/native.ts'
import { plugin, resolveNativeCredentialConfig } from '../src/native.ts'

it('validates the published native provider entry and its configuration', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dsh: { native: unknown }
    exports: Record<string, unknown>
  }
  const metadata = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports)))
  expect(validateNativePluginEntry(plugin, metadata)).toBe(plugin)
  expect(resolveNativeCredentialConfig(undefined)).toEqual({})
  for (const input of [null, [], 'file', { path: 1 }, { watch: 'yes' }, { debounceMs: -1 }, { ignored: true }]) {
    expect(() => resolveNativeCredentialConfig(input)).toThrow('credentials-local:')
  }
})

it('routes committed records through the selected provider and drains child subscriptions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-credential-host-'))
  const rootScope = new NativeScope()
  const authorizationScope = new NativeScope(rootScope)
  const shadowScope = new NativeScope(rootScope)
  const shadowConsumerScope = new NativeScope(shadowScope)
  const environment = createLaunchEnvironmentSnapshot([{ source: 'project-env', values: { DEEPSEEK_API_KEY: 'fallback' } }])
  const changed = Promise.withResolvers<string>()
  let credentials: NativeCredentials | undefined
  let authorizationCredentials: NativeCredentials | undefined
  let authorizationService: NativeAuthorization | undefined
  let shadowCredentials: NativeCredentials | undefined
  const shadowNotifications: string[] = []
  const drainKey = credentialKey('fixture', 'drain')
  const shadowKey = credentialKey('fixture', 'shadow')
  const lateKey = credentialKey('fixture', 'late')
  const enteredDrain = Promise.withResolvers<undefined>()
  const releaseDrain = Promise.withResolvers<undefined>()
  const shadowConsumerAborted = Promise.withResolvers<undefined>()
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'credential-consumer', targets: ['host'], requires: ['credentials'], provides: [],
    resolve: () => (context) => {
      credentials = context.require('credentials')
      context.on('credentials/reference-updated', (ref) => { changed.resolve(ref) })
    },
  }
  const authorizationConsumer: NativePlugin = {
    apiVersion: 1, name: 'credential-authorization-consumer', targets: ['host'],
    requires: ['credentials', 'authorization'], provides: [],
    resolve: () => (context) => {
      authorizationCredentials = context.require('credentials')
      authorizationService = context.require('authorization')
    },
  }
  const shadowConsumer: NativePlugin = {
    apiVersion: 1, name: 'credential-shadow-consumer', targets: ['host'], requires: ['credentials'], provides: [],
    resolve: () => (context) => {
      shadowCredentials = context.require('credentials')
      const onAbort = (): void => { shadowConsumerAborted.resolve(undefined) }
      context.signal.addEventListener('abort', onAbort, { once: true })
      context.own(() => { context.signal.removeEventListener('abort', onAbort) })
      context.effect(shadowCredentials.onRecordUpdated(async (key) => {
        shadowNotifications.push(key)
        if (key === drainKey) {
          enteredDrain.resolve(undefined)
          await releaseDrain.promise
        }
      }))
    },
  }
  const parentRequest = { plugin, scope: rootScope, config: { path: join(root, 'parent.yaml'), watch: false } }
  const shadowRequest = { plugin, scope: shadowScope, config: { path: join(root, 'shadow.yaml'), watch: false } }
  const shadowConsumerRequest = { plugin: shadowConsumer, scope: shadowConsumerScope, config: undefined }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope: rootScope, config: undefined },
    parentRequest,
    { plugin: authorizationPlugin, scope: authorizationScope, config: undefined },
    { plugin: authorizationConsumer, scope: authorizationScope, config: undefined },
    shadowRequest,
    shadowConsumerRequest,
    { plugin: launchEnvironmentProvider(environment), scope: rootScope, config: undefined },
  ], 'host'))
  let removeFlow: (() => Promise<void>) | undefined
  let unsubscribeFailure: (() => Promise<void>) | undefined
  try {
    await host.start()
    if (
      credentials === undefined || authorizationCredentials === undefined
      || authorizationService === undefined || shadowCredentials === undefined
    ) {
      throw new Error('native credential service was not installed')
    }
    const parentCredentials = credentials
    const authCredentials = authorizationCredentials
    const authorization = authorizationService
    const childCredentials = shadowCredentials
    expect(authCredentials).toBe(parentCredentials)
    expect(childCredentials).not.toBe(parentCredentials)

    const ref = credentialRef('DEEPSEEK_API_KEY')
    expect(await parentCredentials.resolve(ref)).toEqual({ value: 'fallback', source: 'project-env' })
    await parentCredentials.set(ref, 'stored')
    expect(await changed.promise).toBe(ref)
    expect(await parentCredentials.resolve(ref)).toEqual({ value: 'stored', source: 'file' })

    const key = credentialKey('fixture', 'authorization')
    const grant = (token: string): CredentialRecord => ({ kind: 'grant', payload: { token } })
    removeFlow = authorization.registerFlow({
      key, label: 'Fixture', methods: [{ id: 'test', label: 'Test' }],
      async run() { await authCredentials.modifyRecord(key, async () => grant('saved')) },
    })
    await expect(authorization.begin({ key }).outcome).resolves.toEqual({ status: 'authorized' })
    expect(await parentCredentials.describeRecord(key)).toMatchObject({ configured: true, kind: 'grant' })
    await removeFlow()

    // An old stored record alone must not satisfy a later authorization attempt.
    removeFlow = authorization.registerFlow({
      key, label: 'Fixture', methods: [{ id: 'test', label: 'Test' }], async run() {},
    })
    await expect(authorization.begin({ key }).outcome).rejects.toMatchObject({ code: 'NOT_COMMITTED' })
    await removeFlow()
    removeFlow = undefined

    {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const failureKey = credentialKey('fixture', 'observer-failure')
        const listenerEntered = Promise.withResolvers<undefined>()
        unsubscribeFailure = parentCredentials.onRecordUpdated(async (updatedKey) => {
          if (updatedKey !== failureKey) return
          listenerEntered.resolve(undefined)
          throw new Error('fixture listener failure')
        })
        await parentCredentials.modifyRecord(failureKey, async () => grant('durable'))
        await listenerEntered.promise
        expect(await parentCredentials.describeRecord(failureKey)).toMatchObject({ configured: true })
        await unsubscribeFailure()
        unsubscribeFailure = undefined
        expect(warn).toHaveBeenCalledWith('credentials-local: record update listener failed for %s', failureKey)
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: 'fixture listener failure' }))
      } finally {
        warn.mockRestore()
      }
    }

    await parentCredentials.modifyRecord(shadowKey, async () => grant('parent'))
    expect(shadowNotifications).toEqual([])
    await childCredentials.modifyRecord(shadowKey, async () => grant('shadow'))
    expect(shadowNotifications).toEqual([shadowKey])
    await childCredentials.modifyRecord(drainKey, async () => grant('drain'))
    await enteredDrain.promise
    let removed = false
    const removal = host.remove(shadowConsumerRequest).then(() => { removed = true })
    await shadowConsumerAborted.promise
    expect(removed).toBe(false)
    await childCredentials.modifyRecord(lateKey, async () => grant('late'))
    expect(shadowNotifications).toEqual([shadowKey, drainKey])
    releaseDrain.resolve(undefined)
    await removal
    await childCredentials.modifyRecord(credentialKey('fixture', 'after-remove'), async () => grant('after'))
    expect(shadowNotifications).toEqual([shadowKey, drainKey])

    await host.stop()
    await expect(parentCredentials.set(ref, 'late')).rejects.toThrow(/disposed/)
  } finally {
    releaseDrain.resolve(undefined)
    await unsubscribeFailure?.()
    await removeFlow?.()
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})

it('deletes a record only while it still matches the expected value', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-credential-delete-'))
  const scope = new NativeScope()
  let credentials: NativeCredentials | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'credential-consumer', targets: ['host'], requires: ['credentials'], provides: [],
    resolve: () => (context) => { credentials = context.require('credentials') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: { path: join(root, '.credentials.yaml'), watch: false } },
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([])), scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (credentials === undefined) throw new Error('native credential service was not installed')
    const key = credentialKey('example', 'account')
    const grant = (token: string): CredentialRecord => ({ kind: 'grant', payload: { token } })
    const holds = (token: string) => (current: CredentialRecord) => current.kind === 'grant'
      && (current.payload as { token?: unknown }).token === token
    await credentials.modifyRecord(key, () => Promise.resolve(grant('old')))
    // A replacement queued before the stale delete must survive it.
    await Promise.all([
      credentials.modifyRecord(key, () => Promise.resolve(grant('new'))),
      credentials.deleteRecord(key, { when: holds('old') }),
    ])
    expect(await credentials.readRecord(key)).toEqual(grant('new'))
    await credentials.deleteRecord(key, { when: holds('new') })
    expect(await credentials.readRecord(key)).toBeUndefined()
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})
