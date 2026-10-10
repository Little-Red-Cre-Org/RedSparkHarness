import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialKey, CredentialRecord, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import { credentialStoreFrom } from '../src/auth-core.ts'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { NativeAccountsProvider } from '../src/accounts.ts'

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
const ACCOUNT_ID = 'account-123'
function accessToken(accountId: string, signature: string): string {
  return `header.${Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url')}.${signature}`
}
const access = accessToken(ACCOUNT_ID, 'old-signature')
const refreshedAccess = accessToken(ACCOUNT_ID, 'fresh-signature')

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url
  return input instanceof URL ? input.href : input
}

class MemoryCredentials {
  readonly records = new Map<CredentialKey, CredentialRecord>()

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return this.records.get(key) }
  async listRecords() {
    return [...this.records].map(([key, record]) => ({ key, kind: record.kind }))
  }
  async modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const next = await mutate(this.records.get(key))
    if (next !== undefined) this.records.set(key, next)
    return next
  }
  async deleteRecord(key: CredentialKey): Promise<void> { this.records.delete(key) }
}

const cases = [
  {
    name: 'parses provider quotas',
    status: 200,
    body: {
      email: 'person@example.com', plan_type: 'plus',
      rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 10800, reset_at: 1_800_000_000 } },
      code_review_rate_limit: { secondary_window: { used_percent: 5 } },
      additional_rate_limits: [{ limit_name: 'tools', rate_limit: { primary_window: { used_percent: 10 } } }],
      credits: { unlimited: false, balance: '12.50' },
    },
    expected: {
      status: 'ready', email: 'person@example.com', plan: 'plus',
      quotas: [
        { name: 'codex', primary: { usedPercent: 20, windowSeconds: 10800, resetsAt: 1_800_000_000 }, secondary: null },
        { name: 'code-review', primary: null, secondary: { usedPercent: 5, windowSeconds: null, resetsAt: null } },
        { name: 'tools', primary: { usedPercent: 10, windowSeconds: null, resetsAt: null }, secondary: null },
      ],
      credits: { unlimited: false, balance: '12.50' },
    },
  },
  {
    name: 'treats null additional quotas as absent and keeps empty entries',
    status: 200,
    body: { additional_rate_limits: [
      { limit_name: 'null', rate_limit: null },
      { limit_name: 'missing' },
    ] },
    expected: {
      status: 'ready', email: null, plan: null,
      quotas: [
        { name: 'null', primary: null, secondary: null },
        { name: 'missing', primary: null, secondary: null },
      ],
      credits: null,
    },
  },
  {
    name: 'treats a null additional quota list as absent',
    status: 200,
    body: { additional_rate_limits: null },
    expected: { status: 'ready', email: null, plan: null, quotas: [], credits: null },
  },
  { name: 'returns a safe HTTP failure', status: 401, body: {}, expected: { status: 'failed', reason: 'HTTP 401' } },
] as const

afterEach(() => vi.unstubAllGlobals())

describe('native account usage', () => {
  it.each(cases)('$name', async ({ status, body, expected }) => {
    const credentials = new MemoryCredentials()
    credentials.records.set(CODEX_KEY, { kind: 'grant', payload: {
      type: 'oauth', siwc: 'chatgpt-plan', clientId: 'client', issuer: 'https://auth.openai.com', subject: 'subject',
      email: 'person@example.com', idToken: 'id-token', extAgentHostId: 'host', scopes: ['chatgpt.tokens.use.direct'],
      access, refresh: 'refresh-token', expires: Date.now() - 1,
    } })
    const profiles = resolveProfiles({ 'openai-codex': {} })
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: async () => undefined,
      auth: {
        credentials: credentialStoreFrom(credentials as unknown as NativeCredentials),
        authContext: { env: async () => undefined, fileExists: async () => false },
      },
    })
    const accounts = new NativeAccountsProvider(credentials as unknown as NativeCredentials, adapter, new AbortController().signal)
    const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => requestUrl(input) === 'https://auth.openai.com/api/accounts/oauth/token'
      ? new Response(JSON.stringify({ access_token: refreshedAccess, refresh_token: 'rotated-refresh', expires_in: 3600,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' }))
      : new Response(JSON.stringify(body), { status }))
    vi.stubGlobal('fetch', request)

    try {
      const result = await accounts.usage(CODEX_KEY)
      expect(result).toEqual(expected)
      expect(JSON.stringify(result)).not.toContain(access)
      expect(JSON.stringify(result)).not.toContain(refreshedAccess)
      const usageCall = request.mock.calls.find(([input]) => requestUrl(input) === 'https://chatgpt.com/backend-api/wham/usage')
      const init = usageCall?.[1]
      expect(new Headers(init?.headers).get('ChatGPT-Account-Id')).toBe(ACCOUNT_ID)
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${refreshedAccess}`)
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(request).toHaveBeenCalledTimes(2)
    } finally {
      adapter.dispose()
    }
  })
})

describe('NativeAccountsProvider DeepSeek delegation', () => {
  it('appends the profile and delegates wallet reads and sign-out', async () => {
    const deepseekKey = credentialKey('deepseek-account', 'default')
    const deepseekAccount = {
      key: deepseekKey,
      profile: vi.fn(async () => ({ status: 'ready' as const, value: {
        id: 'user-id', name: 'Ada', contact: 'ada@example.com', avatarUrl: 'https://img.example/avatar.png',
      } })),
      balance: vi.fn(async () => ({ status: 'ready' as const,
        value: [{ currency: 'CNY' as const, balance: '12.30' }], bonusWallets: [] })),
      signOut: vi.fn(async () => undefined),
    }
    const credentials = { readRecord: async () => undefined } as unknown as NativeCredentials
    const adapter = { getProviderAuth: async () => undefined }
    const accounts = new NativeAccountsProvider(credentials, adapter, new AbortController().signal, deepseekAccount)

    await expect(accounts.list()).resolves.toMatchObject([
      { provider: 'openai-codex' },
      { key: deepseekKey, provider: 'deepseek-account', status: 'ready', identity: {
        email: null, contact: 'ada@example.com', name: 'Ada', avatarUrl: 'https://img.example/avatar.png',
      } },
    ])
    await expect(accounts.balance(deepseekKey)).resolves.toEqual({
      status: 'ready', wallets: [{ currency: 'CNY', balance: '12.30' }], bonusWallets: [],
    })
    await accounts.signOut(deepseekKey)
    expect(deepseekAccount.balance).toHaveBeenCalledOnce()
    expect(deepseekAccount.signOut).toHaveBeenCalledOnce()
  })
})
