/** Native directory-picker choice follows the bound web host, not a Loader tree. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { LaunchEnvironmentSnapshot } from '@redspark/rsh-launch-environment/native'
import type { NativeHttpHost } from '@redspark/rsh-native-web-assets'
import type { NativeDirectoryPicker } from '@redspark/rsh-host-directory-picker/native-capability'
import {
  createAutoDirectoryPicker,
  nativeDirectoryPickerFacts,
  plugin,
  resolveNativeDirectoryPickerAutoConfig,
} from '../src/native.ts'

const quietEnvironment: LaunchEnvironmentSnapshot = {
  get: () => undefined,
  getFrom: () => undefined,
}

function webHost(bindHost: '127.0.0.1' | '0.0.0.0'): NativePlugin {
  return {
    apiVersion: 1,
    name: 'directory-picker-auto-web-host',
    targets: ['host'],
    requires: [],
    provides: ['nativeWebHost'],
    resolve: () => (context) => {
      context.provide('nativeWebHost', { host: bindHost } as NativeHttpHost)
    },
  }
}

const launch: NativePlugin = {
  apiVersion: 1,
  name: 'directory-picker-auto-launch',
  targets: ['host'],
  requires: [],
  provides: ['launchEnvironment'],
  resolve: () => (context) => { context.provide('launchEnvironment', quietEnvironment) },
}

it('validates the listing bound and builds both interactions from explicit facts', async () => {
  expect(resolveNativeDirectoryPickerAutoConfig(undefined)).toEqual({ maxEntries: 1000 })
  expect(() => plugin.resolve({ cwd: '/tmp' })).toThrow()
  const nativeFacts = nativeDirectoryPickerFacts('127.0.0.1', quietEnvironment, 'darwin', {})
  const nativePicker = createAutoDirectoryPicker(nativeFacts, 10)
  expect(nativePicker.capability().kind).toBe('native')
  const browseFacts = nativeDirectoryPickerFacts('0.0.0.0', quietEnvironment, 'linux', {})
  const browsePicker = createAutoDirectoryPicker(browseFacts, 1)
  const capability = browsePicker.capability()
  expect(capability.kind).toBe('browse')
  if (capability.kind !== 'browse') throw new Error('browse capability was not selected')
  const root = await mkdtemp(join(tmpdir(), 'dsh-picker-auto-'))
  try {
    await mkdir(join(root, 'child'))
    const listing = await capability.list(root)
    expect(listing.entries.map(entry => entry.name)).toEqual(['child'])
    const created = await capability.createDirectory(root, 'next')
    expect(created).toBe(join(root, 'next'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('provides browse when the native web host is not loopback-only', async () => {
  const scope = new NativeScope()
  let picker: NativeDirectoryPicker | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'directory-picker-auto-consumer',
    targets: ['host'],
    requires: ['directoryPicker'],
    provides: [],
    resolve: () => (context) => { picker = context.require('directoryPicker') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: webHost('0.0.0.0'), scope, config: undefined },
    { plugin: launch, scope, config: undefined },
    { plugin, scope, config: { maxEntries: 4 } },
  ], 'host'))
  try {
    await host.start()
    if (picker === undefined) throw new Error('directoryPicker was not installed')
    expect(picker.capability().kind).toBe('browse')
  } finally {
    await host.stop()
  }
})
