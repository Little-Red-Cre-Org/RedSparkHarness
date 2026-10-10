import { expect, it, vi } from 'vitest'
import { HarnessError } from '@deepseek-ai/dsh-llm/native'
import { credentialKey, type CredentialKey, type CredentialRecord, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { NativeScope, RuntimeEvents } from '@deepseek-ai/dsh-native-runtime'
import { NativeAuthorizationProvider, type NativeAuthorization } from '../src/native.ts'
import type { AuthorizationFrame } from '../src/types.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const OTHER = credentialKey('llm-pi-ai', 'anthropic')

it.each([
  [new Error('{"device_code":"secret-device-code","user_code":"ABCD"}'), { code: 'FLOW_FAILED' }],
  [new HarnessError('token exchange failed with HTTP 400', 'SIWC_TOKEN_EXCHANGE_FAILED'),
    { code: 'SIWC_TOKEN_EXCHANGE_FAILED', message: 'token exchange failed with HTTP 400' }],
])('exposes only curated flow failure diagnostics (%#)', async (failure, expected) => {
  const state = harness()
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    state.authorization.registerFlow({
      key: KEY,
      label: 'Codex',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      async run() { throw failure },
    })
    const attempt = state.authorization.begin({ key: KEY })
    const outcome = attempt.outcome.catch((error: unknown) => error)
    const frames: AuthorizationFrame[] = []
    for await (const frame of attempt.frames()) frames.push(frame)
    expect(await outcome).toBeInstanceOf(Error)
    expect(frames.at(-1)).toEqual({ type: 'settled', settlement: 'failed', ...expected })
    expect(warning.mock.calls.flat().some(value => String(value).includes('secret-device-code'))).toBe(false)
  } finally {
    warning.mockRestore()
    await state.provider.dispose()
  }
})

/** Build the Provider directly with an in-memory credentials service. */
function harness(beforeCommit?: () => Promise<void>): {
  credentials: NativeCredentials
  authorization: NativeAuthorization
  provider: NativeAuthorizationProvider
} {
  const records = new Map<CredentialKey, CredentialRecord>()
  const scope = new NativeScope()
  const events = new RuntimeEvents()
  const credentials: NativeCredentials = {
    resolve: async () => undefined,
    describe: async () => ({ configured: false, writable: true }),
    set: async () => {},
    unset: async () => {},
    readRecord: async key => records.get(key),
    describeRecord: async (key) => {
      const record = records.get(key)
      return record === undefined
        ? { configured: false, writable: true }
        : { configured: true, kind: record.kind, writable: true }
    },
    listRecords: async () => [...records].map(([key, record]) => ({ key, kind: record.kind })),
    modifyRecord: async (key, mutate, options) => {
      options?.signal?.throwIfAborted()
      const current = records.get(key)
      const next = await mutate(current)
      options?.signal?.throwIfAborted()
      if (next === undefined) return current
      await beforeCommit?.()
      records.set(key, next)
      provider.recordUpdated(key)
      return next
    },
    deleteRecord: async (key, options) => {
      options?.signal?.throwIfAborted()
      if (records.delete(key)) provider.recordUpdated(key)
    },
  }
  const provider = new NativeAuthorizationProvider(scope, credentials, { events })
  return { credentials, authorization: provider, provider }
}

it.each(['success', 'decline', 'removal-and-dispose'] as const)(
  'native authorization: %s', async (scenario) => {
    const state = harness()
    try {
      if (scenario === 'success') {
        state.authorization.registerFlow({
          key: KEY,
          label: 'Codex',
          methods: [{ id: 'oauth', label: 'Sign in' }],
          async run(session) {
            session.notify({ message: 'Continue in your browser' })
            await state.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: { token: 'saved' } }))
          },
        })
        const attempt = state.authorization.begin({ key: KEY })
        const frames: AuthorizationFrame[] = []
        for await (const frame of attempt.frames()) frames.push(frame)
        await expect(attempt.outcome).resolves.toEqual({ status: 'authorized' })
        expect(frames).toEqual([
          { type: 'notice', notice: { message: 'Continue in your browser' } },
          { type: 'settled', settlement: 'authorized' },
        ])
        expect(await state.credentials.describeRecord(KEY)).toMatchObject({ configured: true })
        return
      }

      if (scenario === 'decline') {
        state.authorization.registerFlow({
          key: KEY,
          label: 'Codex',
          methods: [{ id: 'oauth', label: 'Sign in' }],
          async run(session) { await session.prompt({ kind: 'text', message: 'Paste the code' }) },
        })
        const attempt = state.authorization.begin({ key: KEY })
        const frames = attempt.frames()[Symbol.asyncIterator]()
        const prompt = (await frames.next()).value as AuthorizationFrame
        if (prompt.type !== 'prompt') throw new Error('expected a prompt frame')
        attempt.decline(prompt.promptId)
        await expect(attempt.outcome).resolves.toEqual({ status: 'cancelled' })
        expect((await frames.next()).value).toEqual({ type: 'prompt-closed', promptId: prompt.promptId })
        expect((await frames.next()).value).toEqual({ type: 'settled', settlement: 'cancelled' })
        return
      }

      const firstStarted = Promise.withResolvers<undefined>()
      const finishFirst = Promise.withResolvers<undefined>()
      const firstRemoval = state.authorization.registerFlow({
        key: KEY,
        label: 'Codex',
        methods: [{ id: 'oauth', label: 'Sign in' }],
        async run(session) {
          firstStarted.resolve(undefined)
          await finishFirst.promise
          session.signal.throwIfAborted()
        },
      })
      const first = state.authorization.begin({ key: KEY })
      await firstStarted.promise
      let removed = false
      const removal = firstRemoval().then(() => { removed = true })
      await Promise.resolve()
      expect(removed).toBe(false)
      finishFirst.resolve(undefined)
      await removal
      await expect(first.outcome).resolves.toEqual({ status: 'cancelled' })

      const secondStarted = Promise.withResolvers<undefined>()
      const finishSecond = Promise.withResolvers<undefined>()
      state.authorization.registerFlow({
        key: OTHER,
        label: 'Anthropic',
        methods: [{ id: 'oauth', label: 'Sign in' }],
        async run(session) {
          secondStarted.resolve(undefined)
          await finishSecond.promise
          session.signal.throwIfAborted()
        },
      })
      const second = state.authorization.begin({ key: OTHER })
      await secondStarted.promise
      let disposed = false
      const disposal = state.provider.dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(disposed).toBe(false)
      finishSecond.resolve(undefined)
      await disposal
      await expect(second.outcome).resolves.toEqual({ status: 'cancelled' })
      expect(() => state.authorization.begin({ key: OTHER })).toThrow(/disposed/)
    } finally {
      await state.provider.dispose()
    }
  },
)

it.each(['drains-write', 'during-describe'] as const)(
  'native authorization cancel: %s', async (scenario) => {
    const writeStarted = Promise.withResolvers<undefined>()
    const finishWrite = Promise.withResolvers<undefined>()
    const state = harness(scenario === 'drains-write' ? async () => {
      writeStarted.resolve(undefined)
      await finishWrite.promise
    } : undefined)
    try {
      if (scenario === 'drains-write') {
        let runFinished = false
        state.authorization.registerFlow({
          key: KEY,
          label: 'Codex',
          methods: [{ id: 'oauth', label: 'Sign in' }],
          async run(session) {
            await state.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: { token: 'saved' } }), { signal: session.signal })
            runFinished = true
          },
        })
        const attempt = state.authorization.begin({ key: KEY })
        await writeStarted.promise
        let cancelled = false
        const cancellation = attempt.cancel().then(() => { cancelled = true })
        await Promise.resolve()
        expect(cancelled).toBe(false)
        expect(state.authorization.current(KEY)).toBe(attempt)
        finishWrite.resolve(undefined)
        await cancellation
        expect(runFinished).toBe(true)
        await expect(attempt.outcome).resolves.toEqual({ status: 'cancelled' })
        expect(await state.credentials.describeRecord(KEY)).toMatchObject({ configured: true })
        return
      }

      const describeStarted = Promise.withResolvers<undefined>()
      const finishDescribe = Promise.withResolvers<undefined>()
      const describe = state.credentials.describeRecord.bind(state.credentials)
      state.credentials.describeRecord = async (key) => {
        describeStarted.resolve(undefined)
        await finishDescribe.promise
        return describe(key)
      }
      state.authorization.registerFlow({
        key: KEY,
        label: 'Codex',
        methods: [{ id: 'oauth', label: 'Sign in' }],
        async run() {
          await state.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: { token: 'saved' } }))
        },
      })
      const attempt = state.authorization.begin({ key: KEY })
      await describeStarted.promise
      const cancellation = attempt.cancel()
      finishDescribe.resolve(undefined)
      await cancellation
      await expect(attempt.outcome).resolves.toEqual({ status: 'cancelled' })
      expect(await state.credentials.describeRecord(KEY)).toMatchObject({ configured: true })
    } finally {
      finishWrite.resolve(undefined)
      await state.provider.dispose()
    }
  },
)
