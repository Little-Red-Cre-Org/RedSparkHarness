/** Native invariant registration reserves package names without a Cordis context. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { InvariantError } from '../src/error.ts'
import {
  plugin,
  resolveNativeInvariantConfig,
  type NativeInvariantRegistry,
} from '../src/native.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeEvents {
    /**
     * Test-only synchronous ping.
     * @mode sync
     */
    'invariants-native/ping': {
      mode: 'sync'
      args: []
      result: undefined
    }
  }
}

async function boot(config: unknown = undefined): Promise<{
  host: NativeHost
  scope: NativeScope
  registry: NativeInvariantRegistry
}> {
  const scope = new NativeScope()
  let registry: NativeInvariantRegistry | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'invariant-native-consumer',
    targets: ['host'],
    requires: ['invariants'],
    provides: [],
    resolve: () => (context) => {
      registry = context.require('invariants')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config },
  ], 'host'))
  try {
    await host.start()
  } catch (error: unknown) {
    await expect(host.stop()).rejects.toBe(error)
    throw error
  }
  if (registry === undefined) {
    await host.stop()
    throw new Error('invariants registry was not installed')
  }
  return { host, scope, registry }
}

it('rejects malformed native filters at resolution', () => {
  expect(resolveNativeInvariantConfig(undefined)).toMatchObject({ enabled: true })
  expect(plugin.provides).toEqual(['invariants'])
  expect(() => resolveNativeInvariantConfig({ extra: true })).toThrow()
  expect(() => plugin.resolve({ package_allowlist: ['['] })).toThrow(/invalid regex/)
  expect(() => plugin.resolve({ package_blocklist: ['a', 'a'] })).toThrow(/duplicate regex/)
  expect(() => plugin.resolve([])).toThrow()
})

it('runs an admitted installer and drops its subscription on dispose', async () => {
  const state = await boot({ package_allowlist: ['@redspark/rsh-session'] })
  const seen: string[] = []
  let owned = 0
  const dispose = await state.registry.register('@redspark/rsh-session', (host) => {
    expect(host.signal.aborted).toBe(false)
    host.on('invariants-native/ping', () => { seen.push('ping') })
    host.own(async () => { owned += 1 })
  })
  state.host.events.emit(state.scope, 'invariants-native/ping')
  expect(seen).toEqual(['ping'])
  await dispose()
  await dispose()
  state.host.events.emit(state.scope, 'invariants-native/ping')
  expect(seen).toEqual(['ping'])
  expect(owned).toBe(1)
  await state.host.stop()
})

it('reserves a filtered package without calling its installer', async () => {
  const state = await boot({ enabled: false, package_blocklist: ['blocked'] })
  let called = false
  const dispose = await state.registry.register('@redspark/rsh-session', () => { called = true })
  expect(called).toBe(false)
  await expect(state.registry.register('@redspark/rsh-session', () => {})).rejects.toThrow(/already registered/)
  await dispose()
  const again = await state.registry.register('@redspark/rsh-agent', async () => {})
  await again()
  await expect(state.registry.register('', () => {})).rejects.toThrow(/packageName/)
  await state.host.stop()
  await expect(state.registry.register('@redspark/rsh-session', () => {})).rejects.toThrow(/closed/)
})

it('rolls back a failed installer and attributes the failure', async () => {
  const state = await boot()
  let released = false
  await expect(state.registry.register('@redspark/rsh-tools', (host, fail) => {
    host.own(async () => { released = true })
    fail('pipeline broke')
  })).rejects.toMatchObject({ name: 'InvariantError', packageName: '@redspark/rsh-tools', code: 'INVARIANT' })
  expect(released).toBe(true)
  await expect(state.registry.register('@redspark/rsh-tools', async () => {
    throw new Error('async setup failed')
  })).rejects.toThrow(/async setup failed/)
  const dispose = await state.registry.register('@redspark/rsh-tools', () => {})
  await dispose()
  await state.host.stop()
  expect(InvariantError).toBeTypeOf('function')
})

it('aborts an in-flight installer when the registry closes', async () => {
  const state = await boot()
  let subscriptionThrew = false
  let ownershipThrew = false
  await expect(state.registry.register('@redspark/rsh-session', async (host) => {
    await (state.registry as unknown as { close(): Promise<void> }).close()
    try {
      host.on('invariants-native/ping', () => {})
    } catch {
      subscriptionThrew = true
    }
    try {
      host.own(async () => {})
    } catch {
      ownershipThrew = true
    }
  })).rejects.toThrow(/closed/)
  expect(subscriptionThrew).toBe(true)
  expect(ownershipThrew).toBe(true)
  await state.host.stop()
})

it('stops live registrations when the host stops', async () => {
  const state = await boot({ package_allowlist: ['@redspark/'], package_blocklist: ['@redspark/rsh-hidden'] })
  let ran = false
  await state.registry.register('@redspark/rsh-session', (host) => {
    host.on('invariants-native/ping', () => { ran = true })
  })
  await expect(state.registry.register('@redspark/rsh-hidden', () => { ran = true })).resolves.toBeTypeOf('function')
  await state.host.stop()
  expect(() => state.host.events.emit(state.scope, 'invariants-native/ping')).toThrow(/closed/)
  expect(ran).toBe(false)
})
