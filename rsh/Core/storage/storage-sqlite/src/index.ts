/**
 * SQLite storage backend for the storage hub: one database file hosts every
 * routed unit, document-per-row (`key TEXT` / `value TEXT` JSON). Registers
 * as backend `sqlite`; the disposer unregisters first, then closes the medium.
 * @module @redspark/rsh-storage-sqlite
 */

import type { Context } from '@redspark/cordis'
import z from '@redspark/schemastery'
import { storageBackendServiceKey } from '@redspark/rsh-storage'
import { SqliteStorageBackend } from './backend.ts'
import type { JournalMode } from './schema.ts'

export { STORAGE_SQLITE_SCHEMA_VERSION, type JournalMode } from './schema.ts'
export { SqliteStorageBackend } from './backend.ts'
export type { SqliteStorageConfig } from './backend.ts'

/** Cordis plugin name. */
export const name = 'storage-sqlite'
/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing
   * database fail the open. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) suits local disks; pick
   * a rollback-journal mode (`delete`/`truncate`/`persist`) on filesystems
   * where WAL's shared-memory files do not work (network mounts). See
   * {@link JournalMode}.
   */
  journalMode?: JournalMode
}

/** Configuration after Schemastery fills `journalMode`. */
interface ResolvedConfig {
  /** Database path taken from the profile row. */
  path: string
  /** Journal mode, `wal` when the profile omits it. */
  journalMode: JournalMode
}

/** Schemastery validator for {@link Config}. The instance type is the filled configuration. */
export const Config = z.object({
  path: z.string().required(),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
}) as unknown as z<Config, ResolvedConfig>

/**
 * Register the SQLite backend as `sqlite` on the storage hub. The disposer
 * unregisters the name first, then closes the backend.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config) {
  const resolved = new Config(config)
  const backend = new SqliteStorageBackend({ path: resolved.path, journalMode: resolved.journalMode })
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('sqlite', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-sqlite.registerBackend')
  ctx.provide(storageBackendServiceKey('sqlite'), backend)
}
