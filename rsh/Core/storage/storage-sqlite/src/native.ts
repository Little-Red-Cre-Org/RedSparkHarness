/** Native SQLite storage registers the shared backend on the selected hub. */
import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-storage/native'
import { SqliteStorageBackend } from './backend.ts'
import type { JournalMode } from './schema.ts'

const journalModes = ['wal', 'delete', 'truncate', 'persist'] as const satisfies readonly JournalMode[]

/** Explicit database path and journal mode for a native profile row. */
export interface NativeSqliteStorageConfig {
  /** Database file path, or `:memory:` for an in-process database. */
  readonly path: string
  /** SQLite journal mode. Omitted profile fields resolve to `wal`. */
  readonly journalMode: JournalMode
}

/**
 * Validate the native SQLite row without inventing a database path.
 * @param input - untrusted profile fields.
 * @returns immutable path and journal mode.
 */
export function resolveNativeSqliteStorageConfig(input: unknown): NativeSqliteStorageConfig {
  const parsed = z.object({
    path: z.string().min(1),
    journalMode: z.enum(journalModes).default('wal'),
  }).strict().parse(input)
  return Object.freeze({ path: parsed.path, journalMode: parsed.journalMode })
}

/** Provider registration is owned until its accepted unit operations drain. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-storage-sqlite', targets: ['host'],
  requires: ['storage'], provides: ['storageBackendsReady'],
  resolve(input) {
    const config = resolveNativeSqliteStorageConfig(input)
    return (context) => {
      const backend = new SqliteStorageBackend(config)
      context.own(() => backend.close())
      const registry = context.require('storage').backend
      const unregister = registry.register('sqlite', backend)
      context.effect(unregister)
      context.provide('storageBackendsReady', { registry })
    }
  },
}
