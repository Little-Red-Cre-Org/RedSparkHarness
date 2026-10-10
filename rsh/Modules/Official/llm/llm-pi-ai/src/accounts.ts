/** Native account and usage operations for the OpenAI Codex subscription route. */

import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialKey, NativeCredentials, CredentialRecord } from '@deepseek-ai/dsh-credentials/native'
import type { PiAiAdapter } from './adapter.ts'
import { isSiwcCredential } from './siwc.ts'

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
  provider: 'openai-codex'
  status: 'signed-out' | 'ready' | 'unavailable'
  identity: { email: string | null; name: string | null; avatarUrl: null }
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

/** The DeepSeek account endpoint is not available in this composition. */
export type AccountBalance = { status: 'unsupported' }

/** Native account operations for the installed subscription provider. */
export interface NativeAccounts {
  /** @param signal - caller cancellation.
   * @returns the single OpenAI Codex account and its safe credential status.
   */
  list(signal?: AbortSignal): Promise<AccountSummary[]>
  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns safe subscription usage, or a status that carries no credential values.
   */
  usage(key: AccountKey, signal?: AbortSignal): Promise<AccountUsage>
  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns the unsupported status because no DeepSeek account endpoint is installed.
   */
  balance(key: AccountKey, signal?: AbortSignal): Promise<AccountBalance>
  /** @param key - account credential record address to remove.
   * @param signal - caller cancellation while the record deletion is queued.
   * @returns after the record is removed; the SIWC registration record is separate.
   */
  signOut(key: AccountKey, signal?: AbortSignal): Promise<void>
}

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
const CODEX_PROVIDER = 'openai-codex'
const ACCOUNT_ID_CLAIM = 'https://api.openai.com/auth'
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const USAGE_TIMEOUT_MS = 20_000

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid usage response')
  return value as Record<string, unknown>
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new TypeError(`invalid ${field}`)
  return value
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`invalid ${field}`)
  return value
}

function quotaWindow(value: unknown): QuotaWindow | null {
  if (value === undefined || value === null) return null
  const data = object(value)
  if (typeof data.used_percent !== 'number' || !Number.isFinite(data.used_percent)) throw new TypeError('invalid quota window')
  return {
    usedPercent: data.used_percent,
    windowSeconds: optionalNumber(data.limit_window_seconds, 'quota window duration'),
    resetsAt: optionalNumber(data.reset_at, 'quota reset time'),
  }
}

function quota(value: unknown, name: string): Quota {
  const data = object(value)
  return { name, primary: quotaWindow(data.primary_window), secondary: quotaWindow(data.secondary_window) }
}

function parseUsage(value: unknown): Extract<AccountUsage, { status: 'ready' }> {
  const data = object(value)
  const quotas: Quota[] = []
  if (data.rate_limit !== undefined && data.rate_limit !== null) quotas.push(quota(data.rate_limit, 'codex'))
  if (data.code_review_rate_limit !== undefined && data.code_review_rate_limit !== null) {
    quotas.push(quota(data.code_review_rate_limit, 'code-review'))
  }
  if (data.additional_rate_limits !== undefined) {
    if (!Array.isArray(data.additional_rate_limits)) throw new TypeError('invalid additional quotas')
    for (const entry of data.additional_rate_limits) {
      const additional = object(entry)
      if (typeof additional.limit_name !== 'string') throw new TypeError('invalid quota name')
      quotas.push(quota(additional.rate_limit, additional.limit_name))
    }
  }
  let credits: Extract<AccountUsage, { status: 'ready' }>['credits'] = null
  if (data.credits !== undefined && data.credits !== null) {
    const creditData = object(data.credits)
    if (typeof creditData.unlimited !== 'boolean') throw new TypeError('invalid credits')
    credits = { unlimited: creditData.unlimited, balance: optionalString(creditData.balance, 'credit balance') }
  }
  return {
    status: 'ready',
    email: optionalString(data.email, 'email'),
    plan: optionalString(data.plan_type, 'plan'),
    quotas,
    credits,
  }
}

function accountIdFromAccessToken(access: string): string | undefined {
  const payload = access.split('.')[1]
  if (payload === undefined) throw new TypeError('invalid access token')
  const claims = object(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown)
  const authValue = claims[ACCOUNT_ID_CLAIM]
  if (authValue === undefined) return undefined
  const auth = object(authValue)
  return optionalString(auth.chatgpt_account_id, 'account id') ?? undefined
}

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

/** Native Provider for account metadata and provider-reported usage. */
export class NativeAccountsProvider implements NativeAccounts {
  /**
   * @param credentials - records owned by this adapter family.
   * @param adapter - pi-ai auth resolver, including its refresh handling.
   * @param lifetime - cancellation for the Host installation.
   */
  constructor(
    private readonly credentials: NativeCredentials,
    private readonly adapter: Pick<PiAiAdapter, 'getProviderAuth'>,
    private readonly lifetime: AbortSignal,
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
      return [{ key: CODEX_KEY, provider: CODEX_PROVIDER, status: 'signed-out',
        identity: { email: null, name: null, avatarUrl: null }, plan: null }]
    }
    if (record.kind === 'grant' && isSiwcCredential(record.payload)) {
      return [{ key: CODEX_KEY, provider: CODEX_PROVIDER, status: 'ready',
        identity: { email: record.payload.email ?? null, name: null, avatarUrl: null }, plan: null }]
    }
    return [{ key: CODEX_KEY, provider: CODEX_PROVIDER, status: 'unavailable',
      identity: { email: null, name: null, avatarUrl: null }, plan: null }]
  }

  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns safe subscription usage, or a status that carries no credential values.
   */
  async usage(key: AccountKey, signal?: AbortSignal): Promise<AccountUsage> {
    try {
      const timeout = AbortSignal.timeout(USAGE_TIMEOUT_MS)
      const requestSignal = AbortSignal.any(signal === undefined
        ? [this.lifetime, timeout] : [this.lifetime, signal, timeout])
      requestSignal.throwIfAborted()
      const record = await this.credentials.readRecord(key)
      requestSignal.throwIfAborted()
      if (record === undefined) return { status: 'signed-out' }
      if (key !== CODEX_KEY || record.kind !== 'grant' || !isSiwcCredential(record.payload)) {
        return { status: 'failed', reason: 'UNSUPPORTED_ACCOUNT' }
      }
      const auth = await this.adapter.getProviderAuth(CODEX_PROVIDER, requestSignal)
      requestSignal.throwIfAborted()
      const access = auth?.auth.apiKey
      if (typeof access !== 'string' || access.length === 0) return { status: 'failed', reason: 'MISSING_CREDENTIAL' }
      const headers = new Headers({ Authorization: `Bearer ${access}` })
      const accountId = accountIdFromAccessToken(access)
      if (accountId !== undefined) headers.set('ChatGPT-Account-Id', accountId)
      const response = await fetch(USAGE_URL, { headers, redirect: 'error', signal: requestSignal })
      if (!response.ok) return { status: 'failed', reason: `HTTP ${response.status}` }
      return parseUsage(await response.json() as unknown)
    } catch (error: unknown) {
      return { status: 'failed', reason: failureReason(error) }
    }
  }

  /** @param key - account credential record address.
   * @param signal - caller cancellation.
   * @returns the unsupported status because no DeepSeek account endpoint is installed.
   */
  balance(_key: AccountKey, signal?: AbortSignal): Promise<AccountBalance> {
    return signal?.aborted
      ? Promise.reject(cancelled(signal.reason))
      : Promise.resolve({ status: 'unsupported' })
  }

  /** @param key - account credential record address to remove.
   * @param signal - caller cancellation while the record deletion is queued.
   * @returns after the record is removed; the SIWC registration record is separate.
   */
  async signOut(key: AccountKey, signal?: AbortSignal): Promise<void> {
    try {
      await this.credentials.deleteRecord(key, { signal: operationSignal(this.lifetime, signal) })
    } catch (error: unknown) {
      throw cancelled(error)
    }
  }
}
