/** Native and compatibility adapters share domain formats and the same write/publication runtime. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { BackendRegistry, type StorageBackend, type KvUnit } from '@deepseek-ai/dsh-storage/backend'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-storage/native'
import { plugin as jsonPlugin } from '@deepseek-ai/dsh-storage-json/native'
import { DomainFacilityCore, defineDomain, domainTable, plugin } from '../src/native.ts'
import type { DomainChanged } from '../src/event-types.ts'
import { MemoryStorageBackend } from './helpers/memory-backend.ts'

const spec = defineDomain({ name: 'native_domain', version: 2,
  global: { schema: z.object({ count: z.number().int() }), initial: { count: 0 } },
  tables: { rows: domainTable<string, { label: string }>(z.object({ label: z.string() })) },
})

async function boot(root: string, config: unknown = { backend: 'json' }) {
  const scope = new NativeScope()
  let facility: DomainFacilityCore | undefined
  const changes: DomainChanged[] = []
  const consumer: NativePlugin = { apiVersion: 1, name: 'native-domain-consumer', targets: ['host'],
    requires: ['storageDomain'], provides: [], resolve: () => (context) => {
      facility = context.require('storageDomain')
      context.on('domain/changed', (change) => { changes.push(change) })
    } }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined }, { plugin, scope, config },
    { plugin: jsonPlugin, scope, config: { root } }, { plugin: storagePlugin, scope, config: undefined },
  ], 'host'))
  try { await host.start() } catch (error: unknown) { await expect(host.stop()).rejects.toBe(error); throw error }
  if (facility === undefined) { await host.stop(); throw new Error('Missing selected domain facility') }
  return { host, facility, changes }
}

it('publishes one durable native write order and cold-opens the unchanged JSON medium', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-domain-'))
  let state = await boot(root)
  try {
    const domain = await state.facility.open(spec)
    await expect(state.facility.open(spec)).rejects.toThrow('already open')
    await Promise.all([domain.global.set({ count: 1 }), domain.table('rows').put('one', { label: 'persisted' }),
      domain.global.set({ count: 2 })])
    expect(state.changes.map(change => [change.table, change.operation])).toEqual([['', 'put'], ['rows', 'put'], ['', 'put']])
    expect(domain.global.get()).toEqual({ count: 2 })
    const bytes = await readFile(join(root, 'native_domain.json'), 'utf8')
    expect(JSON.parse(bytes)).toEqual({ unit: { name: 'native_domain', version: 2 },
      global: { count: 2 }, tables: { rows: { one: { label: 'persisted' } } } })
    await state.host.stop()
    await expect(state.facility.open(spec)).rejects.toThrow('closing')
    state = await boot(root)
    const restored = await state.facility.open(spec)
    expect(restored.global.get()).toEqual({ count: 2 })
    expect(restored.table('rows').get('one')).toEqual({ label: 'persisted' })
    expect(await readFile(join(root, 'native_domain.json'), 'utf8')).toBe(bytes)
    expect(state.changes).toEqual([])
  } finally { await state.host.stop(); await rm(root, { recursive: true }) }
})

it('fails activation for unknown routes before creating a domain or writing the medium', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-domain-route-'))
  try {
    await expect(boot(root, { backend: 'missing' })).rejects.toThrow('not registered')
    await expect(boot(root, { backend: 'json', routes: { native_domain: 'missing' } })).rejects.toThrow('not registered')
  } finally { await rm(root, { recursive: true }) }
})

it('closes admission and drains an accepted load before releasing its unit', async () => {
  const registry = new BackendRegistry()
  const backend = new MemoryStorageBackend()
  const loading = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  let closed = false
  const delayed: StorageBackend = { close: backend.close.bind(backend), kv: { async open(descriptor) {
    const unit = await backend.kv.open(descriptor)
    const observed: KvUnit = {
      async loadAll() { entered.resolve(undefined); await loading.promise; return unit.loadAll() },
      putRecord: unit.putRecord.bind(unit), deleteRecord: unit.deleteRecord.bind(unit), setGlobal: unit.setGlobal.bind(unit),
      async close() { await unit.close(); closed = true },
    }
    return observed
  } } }
  registry.register('memory', delayed)
  const facility = new DomainFacilityCore(registry, { changed() {}, warning() {}, error() {} }, { backend: 'memory' })
  const accepted = facility.open(spec)
  const refused = expect(accepted).rejects.toThrow('closed during')
  await entered.promise
  let drained = false
  const disposal = facility.closeAll().then(() => { drained = true })
  await Promise.resolve()
  expect(drained).toBe(false)
  expect(closed).toBe(false)
  loading.resolve(undefined); await refused; await disposal
  expect(closed).toBe(true)
  await expect(facility.open(spec)).rejects.toThrow('closing')
})

it('reports accepted-load unit cleanup failure to both its caller and Host shutdown', async () => {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const cleanup = new Error('accepted unit cleanup failed')
  const scope = new NativeScope()
  const backend = new MemoryStorageBackend()
  let facility: DomainFacilityCore | undefined
  const delayed: NativePlugin = { apiVersion: 1, name: 'held-cleanup-backend', targets: ['host'],
    requires: ['storage'], provides: ['storageBackendsReady'], resolve: () => (context) => {
      const registry = context.require('storage').backend
      context.own(() => backend.close())
      context.effect(registry.register('memory', { close: backend.close.bind(backend), kv: { async open(descriptor) {
        const unit = await backend.kv.open(descriptor)
        return {
          async loadAll() { entered.resolve(undefined); await release.promise; return unit.loadAll() },
          putRecord: unit.putRecord.bind(unit), deleteRecord: unit.deleteRecord.bind(unit), setGlobal: unit.setGlobal.bind(unit),
          async close() { await unit.close(); throw cleanup },
        }
      } } }))
      context.provide('storageBackendsReady', { registry })
    } }
  const consumer: NativePlugin = { apiVersion: 1, name: 'held-cleanup-consumer', targets: ['host'],
    requires: ['storageDomain'], provides: [], resolve: () => (context) => { facility = context.require('storageDomain') } }
  const host = new NativeHost(resolveInstallation([
    { plugin: storagePlugin, scope, config: undefined }, { plugin: delayed, scope, config: undefined },
    { plugin, scope, config: { backend: 'memory' } }, { plugin: consumer, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (facility === undefined) throw new Error('Missing domain Consumer')
    const opening = facility.open(spec).catch((error: unknown) => error)
    await entered.promise
    const stopping = host.stop().catch((error: unknown) => error)
    release.resolve(undefined)
    expect(await opening).toMatchObject({ errors: [expect.anything(), cleanup] })
    expect(await stopping).toMatchObject({ errors: [{ errors: [{ errors: [cleanup] }] }] })
  } finally {
    release.resolve(undefined)
    // Stop repeats the injected unit cleanup failure after the assertion above.
    await host.stop().catch(() => undefined)
  }
})

it('contains an observer failure after durability without rejecting or rolling back its committed value', async () => {
  const registry = new BackendRegistry()
  registry.register('memory', new MemoryStorageBackend())
  const warning = vi.fn()
  const facility = new DomainFacilityCore(registry, {
    changed() { throw new Error('observer failed') }, warning, error() {},
  }, { backend: 'memory' })
  try {
    const domain = await facility.open(spec)
    await expect(domain.global.set({ count: 3 })).resolves.toBeUndefined()
    expect(domain.global.get()).toEqual({ count: 3 })
    expect(warning).toHaveBeenCalledOnce()
  } finally { await facility.closeAll() }
})

it('accepts a replacement backend readiness Provider without changing the domain Consumer', async () => {
  const scope = new NativeScope()
  let facility: DomainFacilityCore | undefined
  const memory: NativePlugin = { apiVersion: 1, name: 'native-memory-backend', targets: ['host'],
    requires: ['storage'], provides: ['storageBackendsReady'], resolve: () => (context) => {
      const registry = context.require('storage').backend
      const backend = new MemoryStorageBackend()
      context.own(() => backend.close())
      context.effect(registry.register('memory', backend))
      context.provide('storageBackendsReady', { registry })
    } }
  const consumer: NativePlugin = { apiVersion: 1, name: 'replacement-domain-consumer', targets: ['host'],
    requires: ['storageDomain'], provides: [], resolve: () => (context) => { facility = context.require('storageDomain') } }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { backend: 'memory' } }, { plugin: consumer, scope, config: undefined },
    { plugin: memory, scope, config: undefined }, { plugin: storagePlugin, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (facility === undefined) throw new Error('Missing replacement backend Consumer')
    const domain = await facility.open(spec)
    await domain.global.set({ count: 7 })
    expect(domain.global.get()).toEqual({ count: 7 })
  } finally { await host.stop() }
})

it('refuses backend readiness captured from another registry even when the routed name is locally registered', async () => {
  const scope = new NativeScope()
  const foreign: NativePlugin = { apiVersion: 1, name: 'foreign-backend-readiness', targets: ['host'],
    requires: ['storage'], provides: ['storageBackendsReady'], resolve: () => (context) => {
      const backend = new MemoryStorageBackend()
      context.own(() => backend.close())
      context.effect(context.require('storage').backend.register('memory', backend))
      context.provide('storageBackendsReady', { registry: new BackendRegistry() })
    } }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { backend: 'memory' } }, { plugin: foreign, scope, config: undefined },
    { plugin: storagePlugin, scope, config: undefined },
  ], 'host'))
  const startup = host.start()
  await expect(startup).rejects.toThrow('another storage hub')
  const failure: unknown = await startup.catch((error: unknown) => error)
  await expect(host.stop()).rejects.toBe(failure)
})
