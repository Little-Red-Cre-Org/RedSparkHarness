/** Framework-independent credential definition for native providers and consumers. */
import type { CredentialInfo, CredentialKey, CredentialMetadataMigration, CredentialRecord, CredentialRef } from './native-types.ts'
import type {} from '@deepseek-ai/dsh-native-runtime'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { credentials: NativeCredentials }
  interface NativeEvents {
    /**
     * Notify subscribers after a stored reference changes.
     * @mode parallel
     * @param ref - committed reference whose stored value changed.
     */
    'credentials/reference-updated': { mode: 'parallel'; args: [ref: CredentialRef]; result: void }
  }
}

export type {
  ApiKeyRecord, CredentialInfo, CredentialKey, CredentialMetadataMigration, CredentialRecord, CredentialRef, GrantRecord,
} from './native-types.ts'
export {
  credentialRef, isCredentialRefName, isCredentialKeySegment, credentialKey,
  parseCredentialKey, credentialKeyScope, credentialKeyId,
} from './credential-key.ts'

/** A resolved secret and the provider-defined source that supplied it. */
export interface NativeResolvedCredential {
  readonly value: string
  readonly source: string
}

/** Safe presence and writability facts for a stored record. */
export interface NativeCredentialRecordInfo {
  readonly configured: boolean
  readonly kind?: CredentialRecord['kind']
  readonly writable: boolean
}

/** Stored-record address and tag without its secret payload. */
export interface NativeCredentialRecordEntry {
  readonly key: CredentialKey
  readonly kind: CredentialRecord['kind']
}

/** Service implemented by a native credential Provider. */
export interface NativeCredentials {
  resolve(ref: CredentialRef): Promise<NativeResolvedCredential | undefined>
  describe(ref: CredentialRef): Promise<CredentialInfo>
  set(ref: CredentialRef, value: string): Promise<void>
  unset(ref: CredentialRef): Promise<void>
  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>
  /**
   * Read owner-private JSON metadata kept outside enumerable credential records.
   * @param key - owner-scoped address.
   * @returns the JSON value, or `undefined` while absent.
   */
  readMetadata(key: CredentialKey): Promise<unknown>
  /**
   * Read-decide-replace owner-private JSON metadata under the Provider's write lock.
   * Returning `undefined` leaves the current value unchanged.
   * @param key - owner-scoped address.
   * @param mutate - decides the next JSON value from the current one.
   * @param options - `signal` is checked before mutation begins; once it begins the value is committed.
   * @returns the committed value, or the unchanged current value.
   */
  modifyMetadata(
    key: CredentialKey,
    mutate: (current: unknown) => Promise<unknown>,
    options?: NativeCredentialWriteOptions,
  ): Promise<unknown>
  /**
   * Reconcile a legacy record and metadata value under the shared file lock.
   * The Provider verifies the sidecar write before retiring the legacy record.
   * @param key - address shared by the old record and new metadata value.
   * @param migrate - validates detached metadata and legacy values; sibling records are detached copies read from the same locked snapshot.
   * @param options - checked before migration begins; an admitted migration completes atomically.
   * @returns the verified metadata value.
   */
  migrateRecordToMetadata(
    key: CredentialKey,
    migrate: (
      current: unknown,
      legacy: CredentialRecord | undefined,
      readRecord: (key: CredentialKey) => CredentialRecord | undefined,
    ) => Promise<CredentialMetadataMigration>,
    options?: NativeCredentialWriteOptions,
  ): Promise<unknown>
  describeRecord(key: CredentialKey): Promise<NativeCredentialRecordInfo>
  listRecords(): Promise<readonly NativeCredentialRecordEntry[]>
  /**
   * Receive a committed record change from this selected Provider instance.
   * The Provider invokes the listener synchronously after a durable write or
   * removal, or after adopting an observed external change. Asynchronous
   * listener work does not delay the operation. Listener failures are logged
   * and contained; the disposer stops later delivery and drains admitted work.
   * @param listener - callback receiving the changed record address, never its payload.
   * @returns an idempotent disposer; call it outside the listener so it cannot await itself.
   */
  onRecordUpdated(listener: (key: CredentialKey) => void | Promise<void>): () => Promise<void>
  /**
   * Read-decide-replace one record under the Provider's write queue.
   * @param key - record address.
   * @param mutate - decides the next record from the current one; undefined keeps it.
   * @param options - `signal` is checked when the queued write starts, before
   *   reading; once `mutate` begins the write always commits. A queued write
   *   rejects with the signal's reason and writes nothing.
   * @returns the committed record, or the unchanged current one.
   */
  modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    options?: NativeCredentialWriteOptions,
  ): Promise<CredentialRecord | undefined>
  /**
   * Remove one record under the Provider's write queue.
   * @param key - record address.
   * @param options - `signal` is checked inside the queue before the removal commits;
   *   `when` decides against the record as it stands inside the queue, so a later write is never removed.
   */
  deleteRecord(key: CredentialKey, options?: NativeCredentialDeleteOptions): Promise<void>
}

/** Cancellation and an optional in-queue condition for one record removal. */
export interface NativeCredentialDeleteOptions extends NativeCredentialWriteOptions {
  /** Remove only when this returns true for the current record. */
  readonly when?: (current: CredentialRecord) => boolean
}

/** Cancellation for one queued record write. */
export interface NativeCredentialWriteOptions {
  readonly signal?: AbortSignal
}
