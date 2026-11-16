/** Native SQLite registration uses the same backend as the Cordis plugin. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { BackendRegistry } from '@redspark/rsh-storage/backend'
import { plugin as storagePlugin } from '@redspark/rsh-storage/native'
import { plugin, resolveNativeSqliteStorageConfig } from '../src/native.ts'

const descriptor = { name: 'specimen', version: 1, tables: ['records'], hasGlobal: false }

async function boot(path: string) {
  const scope = new NativeScope()
  let registry: BackendRegistry | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'sqlite-native-consumer', targets: ['host'],
    requires: ['storageBackendsReady'], provides: [],
    resolve: () => (context) => { registry = context.require('storageBackendsReady').registry },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: { path } },
    { plugin: storagePlugin, scope, config: undefined },
  ], 'host'))
  try { await host.start() } catch (error: unknown) {
    await expect(host.stop()).rejects.toBe(error)
    throw error
  }
  if (registry === undefined) {
    await host.stop()
    throw new Error('missing sqlite registry')
  }
  return { host, registry }
}

it('rejects a native row that omits the database path', () => {
  expect(() => resolveNativeSqliteStorageConfig({})).toThrow()
  expect(() => resolveNativeSqliteStorageConfig({ path: 'db', extra: true })).toThrow()
})

it('defaults the journal mode and round-trips one record through the selected hub', async () => {
  expect(resolveNativeSqliteStorageConfig({ path: 'db.sqlite' })).toEqual({ path: 'db.sqlite', journalMode: 'wal' })
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-sqlite-'))
  const database = join(root, 'storage.db')
  const state = await boot(database)
  try {
    const backend = state.registry.get('sqlite')
    if (backend?.kv === undefined) throw new Error('sqlite backend was not registered')
    const unit = await backend.kv.open(descriptor)
    await unit.putRecord('records', 'one', { label: 'persisted' })
    expect((await unit.loadAll()).tables.records).toEqual({ one: { label: 'persisted' } })
    await state.host.stop()
    const restored = await boot(database)
    try {
      const again = restored.registry.get('sqlite')
      if (again?.kv === undefined) throw new Error('sqlite backend was not restored')
      const unitAgain = await again.kv.open(descriptor)
      expect((await unitAgain.loadAll()).tables.records).toEqual({ one: { label: 'persisted' } })
    } finally { await restored.host.stop() }
  } finally {
    await state.host.stop().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
