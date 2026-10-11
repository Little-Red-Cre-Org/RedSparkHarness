import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import { NativeAccountsProvider } from '../src/accounts.ts'

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('native account usage', () => {
  it('returns unsupported for SIWC without requesting usage and logs only the reason', async () => {
    const credentials = {
      readRecord: vi.fn(async () => ({ kind: 'grant' as const, payload: {
        type: 'oauth', siwc: 'chatgpt-plan', clientId: '', issuer: 'https://auth.openai.com', subject: '',
        idToken: '', extAgentHostId: '', scopes: [], access: '', refresh: '', expires: 0,
      } })),
    } as unknown as NativeCredentials
    const accounts = new NativeAccountsProvider(credentials, new AbortController().signal)
    const request = vi.fn()
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', request)

    await expect(accounts.usage(CODEX_KEY)).resolves.toEqual({ status: 'failed', reason: 'USAGE_UNSUPPORTED' })
    expect(request).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledExactlyOnceWith('USAGE_UNSUPPORTED')
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
    const accounts = new NativeAccountsProvider(credentials, new AbortController().signal, deepseekAccount)

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
