import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialMetadataMigration,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

/**
 * In-memory credentials provider for the authorization suite. Only the record
 * half is exercised — the seam's whole interest in this service is whether a
 * flow left a record behind — so the reference half answers "nothing stored".
 */
// TODO: near-duplicate of the record half of
// rsh/Modules/Official/credentials/credentials/tests/memory.ts; fold both into a shared
// test-support double when a third suite needs one.
export class MemoryCredentials extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()
  private readonly metadata = new Map<CredentialKey, unknown>()

  override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(undefined)
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: false, writable: true })
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.resolve()
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.resolve()
  }

  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }

  override readMetadata(key: CredentialKey): Promise<unknown> {
    return Promise.resolve(this.metadata.get(key))
  }

  override async modifyMetadata(
    key: CredentialKey,
    mutate: (current: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const current = this.metadata.get(key)
    const next = await mutate(current)
    if (next !== undefined) this.metadata.set(key, next)
    return this.metadata.get(key)
  }

  override async migrateRecordToMetadata(
    key: CredentialKey,
    migrate: (
      current: unknown,
      legacy: CredentialRecord | undefined,
      readRecord: (key: CredentialKey) => CredentialRecord | undefined,
    ) => Promise<CredentialMetadataMigration>,
  ): Promise<unknown> {
    const result = await migrate(this.metadata.get(key), this.records.get(key), (recordKey) => {
      const record = this.records.get(recordKey)
      return record === undefined ? undefined : structuredClone(record)
    })
    if (result.value !== undefined) this.metadata.set(key, result.value)
    if (result.retireRecord) this.records.delete(key)
    return result.value
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = this.records.get(key)
    return Promise.resolve(stored === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: stored.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const current = this.records.get(key)
    const next = await mutate(current)
    if (next === undefined) return current
    this.records.set(key, next)
    this.ctx.emit('credentials/record-updated', key)
    return next
  }

  override deleteRecord(key: CredentialKey): Promise<void> {
    if (this.records.delete(key)) this.ctx.emit('credentials/record-updated', key)
    return Promise.resolve()
  }
}
