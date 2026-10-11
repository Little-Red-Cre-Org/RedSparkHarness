import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import { NativeAccountsProvider } from '../src/accounts.ts'
import { CodexUsageStore } from '../src/rate-limits.ts'

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('native account usage', () => {
  it('returns pending until a snapshot exists and keeps snapshots isolated by grant identity', async () => {
    const grant = (subject: string, email: string) => ({
      type: 'oauth', siwc: 'chatgpt-plan', clientId: 'client', issuer: 'https://auth.openai.com', subject,
      email, idToken: 'id-token', extAgentHostId: 'agent', scopes: ['chatgpt.tokens.use.direct'],
      access: 'access', refresh: 'refresh', expires: 0,
    })
    let currentGrant = grant('subject-a', 'a@example.com')
    const credentials = {
      readRecord: vi.fn(async () => ({ kind: 'grant' as const, payload: currentGrant })),
    } as unknown as NativeCredentials
    const usage = new CodexUsageStore()
    const accounts = new NativeAccountsProvider(credentials, new AbortController().signal, undefined, usage)
    const snapshot = (usedPercent: number) => ({
      quotas: [{ name: 'codex', primary: { usedPercent, windowSeconds: 3600, resetsAt: 1_700_000_000 }, secondary: null }],
      credits: null,
    })
    const accountA = { issuer: 'https://auth.openai.com', subject: 'subject-a' }
    const accountB = { issuer: 'https://auth.openai.com', subject: 'subject-b' }

    await expect(accounts.usage(CODEX_KEY)).resolves.toEqual({ status: 'failed', reason: 'USAGE_PENDING' })
    usage.observe(accountA, snapshot(35), true)
    usage.observe(accountB, snapshot(90), true)
    await expect(accounts.usage(CODEX_KEY)).resolves.toEqual({
      status: 'ready', email: 'a@example.com', plan: null, ...snapshot(35),
    })

    currentGrant = grant('subject-b', 'b@example.com')
    await expect(accounts.usage(CODEX_KEY)).resolves.toEqual({
      status: 'ready', email: 'b@example.com', plan: null, ...snapshot(90),
    })
  })
})

describe('NativeAccountsProvider DeepSeek delegation', () => {
  it('appends the profile and delegates wallet reads and sign-out', async () => {
    const deepseekKey = credentialKey('deepseek-account', 'default')
    const deepseekAccount = {
      key: deepseekKey,
      resolveToken: vi.fn(async () => undefined),
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
