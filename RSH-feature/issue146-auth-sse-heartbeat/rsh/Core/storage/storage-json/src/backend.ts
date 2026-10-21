/** Shared JSON backend preserves the existing unit layouts, atomic publication and one-open lifecycle. */
import { mkdir } from 'node:fs/promises'
import { StorageError } from '@deepseek-ai/dsh-storage/backend'
import { UNIT_NAME_RE, type KvFacet, type KvUnit, type KvUnitDescriptor, type StorageBackend } from '@deepseek-ai/dsh-storage/backend'
import { openSingleUnit } from './single-unit.ts'
import { openPerRecordUnit } from './per-record-unit.ts'

/** JSON backend: owns the file-tree root and serves the `kv` facet. */
export class JsonStorageBackend implements StorageBackend {
  private readonly open = new Map<string, KvUnit>()
  // Reserved synchronously at open() entry so a concurrent open of the same
  // unit fails, and close() can await opens still in flight.
  private readonly opening = new Map<string, Promise<KvUnit>>()
  private closed = false
  private disposal: Promise<void> | undefined

  /** @param root - explicit existing medium root used by either runtime adapter. */
  constructor(private readonly root: string) {}

  readonly kv: KvFacet = {
    // The body up to the first await runs synchronously, so the opening-slot
    // reservation below still excludes a concurrent open of the same unit.
    open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      validateDescriptor(descriptor)
      if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) {
        // Double-open is a caller bug, not a medium condition.
        throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`)
      }
      const opening = this.openUnit(descriptor)
      this.opening.set(descriptor.name, opening)
      return opening.finally(() => this.opening.delete(descriptor.name))
    },
  }

  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    // The two layouts differ in medium shape only; each opener owns its own
    // path convention under the shared root.
    const onClose = () => this.open.delete(descriptor.name)
    const unit = descriptor.layout === 'per-record'
      ? await openPerRecordUnit(descriptor, this.root, onClose)
      : await openSingleUnit(descriptor, this.root, onClose)
    if (this.closed) {
      // The backend closed while this open was in flight: do not hand out a
      // live unit past close().
      await unit.close()
      throw new StorageError('closed', 'json backend is closed')
    }
    this.open.set(descriptor.name, unit)
    return unit
  }

  /** Close admission and drain all accepted opens and units. @returns completion after every unit releases. */
  close(): Promise<void> {
    this.closed = true
    return this.disposal ??= (async () => {
      await Promise.allSettled([...this.opening.values()])
      const results = await Promise.allSettled([...this.open.values()].map(unit => unit.close()))
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
      if (failures.length > 0) throw new AggregateError(failures, 'JSON storage cleanup failed')
    })()
  }
}

function validateDescriptor(descriptor: KvUnitDescriptor): void {
  if (!UNIT_NAME_RE.test(descriptor.name)) {
    throw new StorageError('malformed-medium', `invalid unit name '${descriptor.name}'`)
  }
  for (const table of descriptor.tables) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new StorageError('malformed-medium', `invalid table name '${table}' in unit '${descriptor.name}'`)
    }
  }
}
