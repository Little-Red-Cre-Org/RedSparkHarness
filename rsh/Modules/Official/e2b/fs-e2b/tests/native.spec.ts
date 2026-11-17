/** Native E2B filesystem registration provides one backend for the selected sandbox. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { E2BSandboxOwner } from '@redspark/rsh-e2b/owner'
import { FsError, FsTargetKey } from '@redspark/rsh-fs/types'
import type { FsTarget } from '@redspark/rsh-fs/types'
import { E2BFileSystemBackend } from '../src/backend.ts'
import { plugin, resolveNativeE2BFilesystemConfig } from '../src/native.ts'

it('rejects every non-empty native configuration row', () => {
  expect(() => { resolveNativeE2BFilesystemConfig(undefined) }).not.toThrow()
  expect(() => { resolveNativeE2BFilesystemConfig({}) }).not.toThrow()
  expect(plugin.resolve(undefined)).toEqual(expect.any(Function))
  expect(plugin.resolve({})).toEqual(expect.any(Function))
  for (const input of [null, [], 'path', 1, { cwd: '/workspace' }]) {
    expect(() => plugin.resolve(input)).toThrow('fs-e2b: native Provider accepts no configuration')
  }
})

it('provides the filesystem backend and reads the owner cwd without a sandbox', async () => {
  let sandboxCalls = 0
  let cwdReads = 0
  const owner = {
    get cwd() {
      cwdReads += 1
      return '/workspace'
    },
    runtimeRoot: '/workspace/.dsh-e2b',
    getSandbox: async () => {
      sandboxCalls += 1
      throw new Error('sandbox was not required')
    },
  } as unknown as E2BSandboxOwner
  const scope = new NativeScope()
  const e2b: NativePlugin = {
    apiVersion: 1,
    name: 'e2b-stub',
    targets: ['host'],
    requires: [],
    provides: ['e2b'],
    resolve: () => (context) => { context.provide('e2b', owner) },
  }
  let service: E2BFileSystemBackend | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'fs-e2b-consumer',
    targets: ['host'],
    requires: ['fs'],
    provides: [],
    resolve: () => (context) => {
      const provided = context.require('fs')
      if (!(provided instanceof E2BFileSystemBackend)) throw new Error('fs service was not the E2B backend')
      service = provided
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: undefined },
    { plugin: e2b, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (service === undefined) throw new Error('fs service was not provided')
  const target: FsTarget = { targetKey: FsTargetKey('/workspace/note.txt'), displayPath: '/workspace/note.txt' }
  expect(service.fileUrl(target)).toBe('file:///workspace/note.txt')
  await expect(service.resolve('   ')).rejects.toBeInstanceOf(FsError)
  await expect(service.resolve('   ')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  expect(sandboxCalls).toBe(0)
  await expect(service.resolve('note.txt')).rejects.toThrow('sandbox was not required')
  expect(cwdReads).toBeGreaterThan(0)
  expect(sandboxCalls).toBe(1)
  await host.stop()
})
