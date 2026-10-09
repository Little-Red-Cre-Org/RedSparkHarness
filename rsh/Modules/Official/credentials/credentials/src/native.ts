/** Framework-independent credential definition for native providers and consumers. */
import type { CredentialInfo, CredentialKey, CredentialRecord, CredentialRef } from './native-types.ts'
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
    /**
     * Notify subscribers after a stored record changes.
     * @mode parallel
     * @param key - committed record whose stored value changed.
     */
    'credentials/record-updated': { mode: 'parallel'; args: [key: CredentialKey]; result: void }
  }
}

export type {
  ApiKeyRecord, CredentialInfo, CredentialKey, CredentialRecord, CredentialRef, GrantRecord,
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
  describeRecord(key: CredentialKey): Promise<NativeCredentialRecordInfo>
  listRecords(): Promise<readonly NativeCredentialRecordEntry[]>
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
   * @param options - `signal` is checked inside the queue before the removal commits.
   */
  deleteRecord(key: CredentialKey, options?: NativeCredentialWriteOptions): Promise<void>
}

/** Cancellation for one queued record write. */
export interface NativeCredentialWriteOptions {
  readonly signal?: AbortSignal
}
