/** Native E2B subprocess registration provides one backend and owns its teardown. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { E2BSandboxOwner } from '@redspark/rsh-e2b/owner'
import type { SubprocessOperations } from '@redspark/rsh-subprocess/native'
import { E2BSubprocessBackend, resolveE2BSubprocessPollMs } from '../src/backend.ts'
import { plugin, resolveNativeE2BSubprocessConfig } from '../src/native.ts'

it('defaults pollMs and rejects non-positive, fractional, unsafe, and unknown rows', () => {
  expect(resolveNativeE2BSubprocessConfig(undefined)).toEqual({ pollMs: 20 })
  expect(resolveNativeE2BSubprocessConfig({})).toEqual({ pollMs: 20 })
  expect(resolveNativeE2BSubprocessConfig({ pollMs: 5 })).toEqual({ pollMs: 5 })
  expect(resolveE2BSubprocessPollMs(20)).toBe(20)
  expect(() => resolveNativeE2BSubprocessConfig({ pollMs: 0 })).toThrow('subprocess-e2b: pollMs must be a positive safe integer')
  expect(() => plugin.resolve({ pollMs: 1.5 })).toThrow('subprocess-e2b: pollMs must be a positive safe integer')
  expect(() => resolveE2BSubprocessPollMs(2 ** 53)).toThrow('subprocess-e2b: pollMs must be a positive safe integer')
  expect(() => plugin.resolve({ pollMs: 20, extra: true })).toThrow()
  expect(() => plugin.resolve(null)).toThrow()
})

it('provides the subprocess backend and stops with no live processes', async () => {
  const owner = {
    cwd: '/workspace',
    runtimeRoot: '/workspace/.dsh-e2b',
    getSandbox: async () => { throw new Error('sandbox was not required') },
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
  let service: SubprocessOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'subprocess-e2b-consumer',
    targets: ['host'],
    requires: ['subprocess'],
    provides: [],
    resolve: () => (context) => { service = context.require('subprocess') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: undefined },
    { plugin: e2b, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (!(service instanceof E2BSubprocessBackend)) throw new Error('subprocess service was not the E2B backend')
  await host.stop()
})
