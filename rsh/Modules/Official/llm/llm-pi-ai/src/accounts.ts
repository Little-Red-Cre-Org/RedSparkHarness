/** Native account operations for supported provider accounts. */

import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialKey, NativeCredentials, CredentialRecord } from '@deepseek-ai/dsh-credentials/native'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account/native'
import { isSiwcCredential } from './siwc.ts'
import { CodexUsageStore } from './rate-limits.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { accounts: NativeAccounts }
  interface NativeEvents {
    /** A supported account credential record changed.
     * @mode parallel
     * @param key - the updated account credential record.
     */
    'accounts/changed': { mode: 'parallel'; args: [key: AccountKey]; result: void }
  }
}

/** Credential record address accepted by account operations. */
export type AccountKey = CredentialKey

/** Safe identity and plan summary for one account. */
export type AccountSummary = {
  key: AccountKey
  provider: 'openai-codex' | 'deepseek-account'
  status: 'signed-out' | 'ready' | 'unavailable'
  identity: { email: string | null; contact: string | null; name: string | null; avatarUrl: string | null }
  plan: string | null
}

/** One provider-reported quota window; `resetsAt` is Unix seconds. */
export type QuotaWindow = { usedPercent: number; windowSeconds: number | null; resetsAt: number | null }

/** One provider-reported quota group. */
export type Quota = { name: string; primary: QuotaWindow | null; secondary: QuotaWindow | null }

/** Safe usage response without authentication material. */
export type AccountUsage =
  | { status: 'ready'; email: string | null; plan: string | null; quotas: Quota[]; credits: { unlimited: boolean; balance: string | null } | null }
  | { status: 'signed-out' }
  | { status: 'failed'; reason: string }

/** Wallet balances, or the account operation's status. */
export type AccountBalance =
  | { status: 'ready'; wallets: readonly { currency: 'CNY' | 'USD'; balance: string }[]; bonusWallets: readonly { currency: 'CNY' | 'USD'; balance: string }[] }
  | { status: 'signed-out' | 'failed' | 'unsupported' }

/** Native account operations for the installed subscription provider. */
export interface NativeAccounts {
  /** @param signal - caller cancellation.
   * @returns OpenAI Codex and any installed DeepSeek account with safe identity data.
   */
  list(signal?: AbortSignal): Promise<AccountSummary[]>
  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns observed subscription usage; SIWC grants return `failed` with reason `USAGE_PENDING` until a model call reports limits.
   */
  usage(key: AccountKey, signal?: AbortSignal): Promise<AccountUsage>
  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns DeepSeek wallets for its account key, or unsupported when that provider is absent.
   */
  balance(key: AccountKey, signal?: AbortSignal): Promise<AccountBalance>
  /** @param key - account credential record address to remove.
   * @param signal - caller cancellation while the record deletion is queued.
   * @returns after the record is removed; DeepSeek Platform logout runs in the background.
   */
  signOut(key: AccountKey, signal?: AbortSignal): Promise<void>
}

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
const DEEPSEEK_ACCOUNT_KEY = credentialKey('deepseek-account', 'default')
const CODEX_PROVIDER = 'openai-codex'

function failureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(error.code)) return error.code
  const name = error instanceof Error ? error.name : 'Error'
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) ? name : 'Error'
}

function cancelled(reason: unknown): Error {
  return new Error(failureReason(reason))
}

function operationSignal(lifetime: AbortSignal, caller?: AbortSignal): AbortSignal {
  return AbortSignal.any(caller === undefined ? [lifetime] : [lifetime, caller])
}

function failedUsage(reason: string): AccountUsage {
  console.info(reason)
  return { status: 'failed', reason }
}

/** Native Provider for account metadata and usage status. */
export class NativeAccountsProvider implements NativeAccounts {
  /**
   * @param credentials - records owned by this adapter family.
   * @param lifetime - cancellation for the Host installation.
   * @param deepseekAccount - optional Platform profile and balance provider.
   * @param codexUsage - process-local snapshots observed from Codex Responses calls.
   */
  constructor(
    private readonly credentials: NativeCredentials,
    private readonly lifetime: AbortSignal,
    private readonly deepseekAccount?: DeepSeekAccount,
    private readonly codexUsage = new CodexUsageStore(),
  ) {}

  /** @param signal - caller cancellation.
   * @returns the single OpenAI Codex account and its safe credential status.
   */
  async list(signal?: AbortSignal): Promise<AccountSummary[]> {
    if (signal?.aborted) throw cancelled(signal.reason)
    let record: CredentialRecord | undefined
    try { record = await this.credentials.readRecord(CODEX_KEY) }
    catch (error: unknown) { throw cancelled(error) }
    if (signal?.aborted) throw cancelled(signal.reason)
    if (record === undefined) {
      return this.deepseekSummary([{ key: CODEX_KEY, provider: CODEX_PROVIDER, status: 'signed-out',
        identity: { email: null, contact: null, name: null, avatarUrl: null }, plan: null }], signal)
    }
    if (record.kind === 'grant' && isSiwcCredential(record.payload)) {
      return this.deepseekSummary([{ key: CODEX_KEY, provider: CODEX_PROVIDER, status: 'ready',
        identity: {
          email: record.payload.email ?? null,
          contact: record.payload.email ?? null,
          name: record.payload.name ?? null,
          avatarUrl: record.payload.picture ?? null,
        },
        plan: null }], signal)
    }
    return this.deepseekSummary([{ key: CODEX_KEY, provider: CODEX_PROVIDER, status: 'unavailable',
      identity: { email: null, contact: null, name: null, avatarUrl: null }, plan: null }], signal)
  }

  private async deepseekSummary(accounts: AccountSummary[], signal?: AbortSignal): Promise<AccountSummary[]> {
    if (this.deepseekAccount === undefined) return accounts
    if (signal?.aborted) throw cancelled(signal.reason)
    const profile = await this.deepseekAccount.profile(signal)
    if (signal?.aborted) throw cancelled(signal.reason)
    if (profile === null) {
      accounts.push({ key: this.deepseekAccount.key, provider: 'deepseek-account', status: 'signed-out',
        identity: { email: null, contact: null, name: null, avatarUrl: null }, plan: null })
    } else if (profile.status === 'ready') {
      accounts.push({ key: this.deepseekAccount.key, provider: 'deepseek-account', status: 'ready',
        identity: { email: null, contact: profile.value.contact, name: profile.value.name, avatarUrl: profile.value.avatarUrl },
        plan: null })
    } else {
      accounts.push({ key: this.deepseekAccount.key, provider: 'deepseek-account', status: 'unavailable',
        identity: { email: null, contact: null, name: null, avatarUrl: null }, plan: null })
    }
    return accounts
  }

  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns observed subscription usage; SIWC grants return `failed` with reason `USAGE_PENDING` until a model call reports limits.
   */
  async usage(key: AccountKey, signal?: AbortSignal): Promise<AccountUsage> {
    try {
      const requestSignal = operationSignal(this.lifetime, signal)
      requestSignal.throwIfAborted()
      const record = await this.credentials.readRecord(key)
      requestSignal.throwIfAborted()
      if (record === undefined) return { status: 'signed-out' }
      if (key !== CODEX_KEY || record.kind !== 'grant' || !isSiwcCredential(record.payload)) {
        return failedUsage('UNSUPPORTED_ACCOUNT')
      }
      const snapshot = this.codexUsage.get({ issuer: record.payload.issuer, subject: record.payload.subject })
      if (snapshot === undefined) return { status: 'failed', reason: 'USAGE_PENDING' }
      return {
        status: 'ready',
        email: record.payload.email ?? null,
        plan: snapshot.plan,
        quotas: [...snapshot.quotas],
        credits: snapshot.credits,
      }
    } catch (error: unknown) {
      return failedUsage(failureReason(error))
    }
  }

  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns the unsupported status because no DeepSeek account endpoint is installed.
   */
  async balance(key: AccountKey, signal?: AbortSignal): Promise<AccountBalance> {
    if (signal?.aborted) throw cancelled(signal.reason)
    if (key !== DEEPSEEK_ACCOUNT_KEY || this.deepseekAccount === undefined) return { status: 'unsupported' }
    const result = await this.deepseekAccount.balance(signal)
    if (signal?.aborted) throw cancelled(signal.reason)
    if (result === null) return { status: 'signed-out' }
    if (result.status === 'failed') return { status: 'failed' }
    return { status: 'ready', wallets: result.value, bonusWallets: result.bonusWallets }
  }

  /** @param key - account credential record address to remove.
   * @param signal - caller cancellation while the record deletion is queued.
   * @returns after the record is removed; the SIWC registration record is separate.
   */
  async signOut(key: AccountKey, signal?: AbortSignal): Promise<void> {
    if (key === DEEPSEEK_ACCOUNT_KEY && this.deepseekAccount !== undefined) {
      await this.deepseekAccount.signOut(signal)
      return
    }
    try {
      await this.credentials.deleteRecord(key, { signal: operationSignal(this.lifetime, signal) })
    } catch (error: unknown) {
      throw cancelled(error)
    }
  }
}
