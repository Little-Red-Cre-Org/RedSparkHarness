import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { credentialKey, credentialRef, type CredentialRecord, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
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

it('mounts a real native credential provider, publishes changes, and drains on stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-credential-host-'))
  const scope = new NativeScope()
  const environment = createLaunchEnvironmentSnapshot([{ source: 'project-env', values: { DEEPSEEK_API_KEY: 'fallback' } }])
  const changed = Promise.withResolvers<string>()
  let credentials: NativeCredentials | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'credential-consumer', targets: ['host'], requires: ['credentials'], provides: [],
    resolve: () => (context) => {
      credentials = context.require('credentials')
      context.on('credentials/reference-updated', (ref) => { changed.resolve(ref) })
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: { path: join(root, '.credentials.yaml'), watch: false } },
    { plugin: launchEnvironmentProvider(environment), scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (credentials === undefined) throw new Error('native credential service was not installed')
    const ref = credentialRef('DEEPSEEK_API_KEY')
    expect(await credentials.resolve(ref)).toEqual({ value: 'fallback', source: 'project-env' })
    await credentials.set(ref, 'stored')
    expect(await changed.promise).toBe(ref)
    expect(await credentials.resolve(ref)).toEqual({ value: 'stored', source: 'file' })
    await host.stop()
    await expect(credentials.set(ref, 'late')).rejects.toThrow(/disposed/)
  } finally {
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
