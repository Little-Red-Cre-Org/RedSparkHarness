/**
 * SQLite KV backend shared by the Cordis plugin and the Native provider.
 * @module @redspark/rsh-storage-sqlite/backend
 */

import type { DatabaseSync } from 'node:sqlite'
import { StorageError, UNIT_NAME_RE } from '@redspark/rsh-storage/backend'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@redspark/rsh-storage/backend'
import { openDatabase, recordTableName, type JournalMode } from './schema.ts'
import { SqliteKvUnit } from './unit.ts'

/** Explicit medium path and journal mode. Callers apply defaults before construction. */
export interface SqliteStorageConfig {
  /** Database path, or `:memory:` for an in-process database. */
  readonly path: string
  /** SQLite journal mode. Native and Cordis resolvers default this to `wal`. */
  readonly journalMode: JournalMode
}

/** SQLite key-value backend shared by the Cordis plugin and the Native provider. */
export class SqliteStorageBackend implements StorageBackend {
  /** The key-value facet; the only shape this backend serves. */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  private readonly ready: Promise<DatabaseSync>
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<SqliteKvUnit>>()
  private closing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   */
  constructor(config: SqliteStorageConfig) {
    this.ready = openDatabase(config.path, config.journalMode)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'sqlite storage backend is closed'))
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
      }
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    // Reserve the name synchronously so a concurrent second open of the same
    // name rejects instead of racing past the guard during the awaits below.
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<SqliteKvUnit> {
    const db = await this.ready
    const row = db.prepare('SELECT version FROM units WHERE name = ?').get(descriptor.name) as
      | { version: number }
      | undefined
    if (row === undefined) {
      db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run(descriptor.name, descriptor.version)
    } else if (row.version !== descriptor.version) {
      throw new StorageError(
        'version-mismatch',
        `kv unit '${descriptor.name}' is stamped version ${row.version} on the medium, incompatible with descriptor version ${descriptor.version}`,
      )
    }
    for (const table of descriptor.tables) {
      // Both segments passed UNIT_NAME_RE, so the identifier is safe in DDL.
      db.exec(`
        CREATE TABLE IF NOT EXISTS "${recordTableName(descriptor.name, table)}" (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT
      `)
    }
    return new SqliteKvUnit(db, descriptor, () => {
      this.units.delete(descriptor.name)
    })
  }

  /**
   * Close every open unit and release the database. Idempotent; concurrent
   * and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let db: DatabaseSync
    try {
      db = await this.ready
    } catch {
      // The medium never opened; that failure already rejected the opener and
      // every unit call, so there is nothing left to release here.
      return
    }
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    db.close()
  }
}
