import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import type { AuthorizationFlow, NativeAuthorization } from '@deepseek-ai/dsh-authorization/native'
import type { NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { AuthEvent, AuthInteraction, AuthPrompt, AuthType, Credential } from '@earendil-works/pi-ai'

const login = vi.hoisted(() => vi.fn())
const nativeModels = vi.hoisted(() => ({ auth: undefined as unknown, collections: 0, refreshes: 0 }))

// The whole of what this module does with pi-ai is run one provider's login
// against a collection built with the harness store, so the collection is the
// boundary worth observing; a real login would open a browser.
vi.mock('@earendil-works/pi-ai', async importOriginal => ({
  ...await importOriginal<typeof import('@earendil-works/pi-ai')>(),
  createModels: (auth: unknown) => {
    nativeModels.auth = auth
    nativeModels.collections++
    return {
      setProvider: () => {},
      login,
      getAuth: async () => ({ auth: { apiKey: 'synthetic-access' } }),
      refresh: async () => { nativeModels.refreshes++; return { errors: new Map() } },
      getModels: () => [],
    }
  },
}))

vi.mock('../src/siwc.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/siwc.ts')>()
  return {
    ...actual,
    createSiwcOAuth(credentials: Parameters<typeof actual.createSiwcOAuth>[0]): ReturnType<typeof actual.createSiwcOAuth> {
      const oauth = actual.createSiwcOAuth(credentials)
      return {
        ...oauth,
        login: interaction => login('openai-codex', 'oauth', interaction) as ReturnType<typeof oauth.login>,
      }
    },
  }
})

const { credentialStoreFrom, authContextFrom, recordKeyFor } = await import('../src/auth.ts')
const { catalogProvider } = await import('../src/catalog.ts')
const { registerPiAiFlows } = await import('../src/login.ts')
const { plugin: nativePlugin } = await import('../src/native.ts')
const anthropicApiKey = catalogProvider('anthropic')?.auth.apiKey
if (anthropicApiKey?.login !== undefined) {
  anthropicApiKey.login = ((interaction: AuthInteraction) =>
    login('anthropic', 'api_key', interaction) as Promise<Credential>) as typeof anthropicApiKey.login
}

const CODEX = recordKeyFor('openai-codex')
const dirs: string[] = []

/** A context with the record store, the seam, and every pi-ai login flow. */
async function harness(): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-login-'))
  dirs.push(dir)
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  registerPiAiFlows(ctx, { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) })
  return ctx
}

/** An interaction recording everything a flow says, answering every question. */
function surface(answer = 'typed'): AuthorizationInteraction & {
  notices: AuthorizationNotice[]
  prompts: AuthorizationPrompt[]
} {
  const notices: AuthorizationNotice[] = []
  const prompts: AuthorizationPrompt[] = []
  return {
    notices,
    prompts,
    notify: (notice) => { notices.push(notice) },
    prompt: (prompt) => {
      prompts.push(prompt)
      return Promise.resolve(answer)
    },
  }
}

/** Drive one attempt, letting the mocked login talk back through `converse`. */
async function attempt(
  ctx: Context,
  converse: (interaction: AuthInteraction) => Promise<void>,
  request: { key?: CredentialKey; method?: string } = {},
): Promise<ReturnType<typeof surface>> {
  const ui = surface()
  login.mockImplementation(async (providerId: string, _type: AuthType, interaction: AuthInteraction) => {
    await converse(interaction)
    const granted: Credential = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 }
    await credentialStoreFrom(ctx).modify(providerId, () => Promise.resolve(granted))
    return granted
  })
  await expect(ctx.authorization.begin({
    key: request.key ?? CODEX,
    interaction: ui,
    ...request.method === undefined ? {} : { method: request.method },
  })).resolves.toEqual({ status: 'authorized' })
  return ui
}

afterEach(async () => {
  login.mockReset()
  nativeModels.auth = undefined
  nativeModels.collections = 0
  nativeModels.refreshes = 0
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('pi-ai login flows', () => {
  it.each([false, true])('native login and catalog services follow optional authorization (%s)', async (withAuthorization) => {
    const writeSignals: (AbortSignal | undefined)[] = []
    const credentials = {
      resolve: async () => undefined,
      readRecord: async () => undefined,
      listRecords: async () => [],
      modifyRecord: async (_key: string, mutate: (record: undefined) => Promise<unknown>, options?: { signal?: AbortSignal }) => {
        writeSignals.push(options?.signal)
        return mutate(undefined)
      },
      deleteRecord: async () => {},
    } as unknown as NativeCredentials
    const flows: AuthorizationFlow[] = []
    const authorization = {
      registerFlow(flow: AuthorizationFlow) { flows.push(flow); return async () => {} },
    } as unknown as NativeAuthorization
    const services = new Map<string, unknown>()
    const disposers: (() => void | Promise<void>)[] = []
    const effects: (() => void | Promise<void>)[] = []
    let recordUpdated: ((key: string) => void) | undefined
    const signal = new AbortController().signal
    const context = {
      signal,
      require: (name: string) => name === 'credentials'
        ? credentials
        : createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]),
      optional: (name: string) => name === 'authorization' && withAuthorization ? authorization : undefined,
      own(dispose: () => void | Promise<void>) { disposers.push(dispose); return async () => {} },
      effect(dispose: () => void | Promise<void>) { effects.push(dispose); return async () => {} },
      on: (_key: string, listener: (key: string) => void) => { recordUpdated = listener; return async () => {} },
      provide: (name: string, service: unknown) => { services.set(name, service) },
    } as unknown as NativeContext

    try {
      await nativePlugin.resolve({ providers: { 'openai-codex': {} } })(context)
      const codex = flows.find(flow => flow.key === recordKeyFor('openai-codex'))
      if (!withAuthorization) {
        expect(codex).toBeUndefined()
        expect(effects).toHaveLength(0)
        return
      }

      expect(codex?.methods.map(method => method.id)).toEqual(['oauth'])
      expect(effects).toHaveLength(flows.length)
      const sessionSignal = new AbortController().signal
      login.mockImplementation(async () => (
        { type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: 1 }
      ))
      await codex?.run({ method: 'oauth', signal: sessionSignal, notify: () => {}, prompt: async () => '' })
      expect(writeSignals).toEqual([sessionSignal])

      const directory = services.get('modelDirectory') as {
        catalog(selection: { provider: string; model: string }, signal: AbortSignal): Promise<unknown>
      }
      const catalog = () => directory.catalog({ provider: 'openai-codex', model: '' }, signal)
      const before = nativeModels.collections
      await catalog()
      expect(nativeModels.collections).toBe(before + 1)
      expect(nativeModels.refreshes).toBe(1)
      const afterFirstCatalog = nativeModels.collections
      recordUpdated?.(recordKeyFor('openai-codex'))
      await catalog()
      expect(nativeModels.collections).toBe(afterFirstCatalog + 1)
      expect(nativeModels.refreshes).toBe(2)
    } finally {
      for (const dispose of disposers.reverse()) await dispose()
      for (const dispose of effects.reverse()) await dispose()
    }
  })

  it('offers one flow per installed provider, with the methods that provider ships', async () => {
    const ctx = await harness()
    const offered = ctx.authorization.list()

    // The OAuth-only provider is exactly the case this exists for: nothing
    // else could ever configure it.
    expect(offered.find(entry => entry.key === CODEX)?.methods)
      .toEqual([{ id: 'oauth', label: expect.stringContaining('ChatGPT') as string }])
    // A provider offering both keeps both, the subscription login first.
    expect(offered.find(entry => entry.key === recordKeyFor('anthropic'))?.methods.map(one => one.id))
      .toEqual(['oauth', 'api-key'])
    // A key-only provider still gets a flow, because pi-ai collects the key
    // through its own prompt rather than leaving it to the settings form.
    expect(offered.find(entry => entry.key === recordKeyFor('deepseek'))?.methods.map(one => one.id))
      .toEqual(['api-key'])
  })

  it('runs the pi-ai auth type the chosen method names', async () => {
    const ctx = await harness()

    await attempt(ctx, () => Promise.resolve())
    expect(login).toHaveBeenLastCalledWith('openai-codex', 'oauth', expect.anything())

    await attempt(ctx, () => Promise.resolve(), { key: recordKeyFor('anthropic'), method: 'api-key' })
    expect(login).toHaveBeenLastCalledWith('anthropic', 'api_key', expect.anything())
  })

  it('commits what the login produced, where the adapter reads it back', async () => {
    const ctx = await harness()

    await attempt(ctx, () => Promise.resolve())

    await expect(ctx.credentials.readRecord(CODEX)).resolves.toEqual({
      kind: 'grant',
      payload: { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 },
    })
  })

  it('restates every pi-ai login event in the neutral vocabulary', async () => {
    const ctx = await harness()
    const events: AuthEvent[] = [
      { type: 'info', message: 'Read this first', links: [{ url: 'https://help.example' }] },
      { type: 'info', message: 'Nothing to open' },
      { type: 'auth_url', url: 'https://auth.example/start', instructions: 'Approve in the tab' },
      { type: 'auth_url', url: 'https://auth.example/plain' },
      { type: 'device_code', userCode: 'WXYZ-1234', verificationUri: 'https://device.example' },
      { type: 'progress', message: 'Exchanging the code' },
      // pi-ai's event union is open; an unrecognised member must still show
      // the human that something is happening.
      { type: 'quantum-handshake' } as unknown as AuthEvent,
    ]

    const ui = await attempt(ctx, (interaction) => {
      for (const event of events) interaction.notify(event)
      return Promise.resolve()
    })

    expect(ui.notices).toEqual([
      { message: 'Read this first', url: 'https://help.example' },
      { message: 'Nothing to open' },
      { message: 'Approve in the tab', url: 'https://auth.example/start' },
      { message: 'Open this page to continue signing in.', url: 'https://auth.example/plain' },
      {
        message: 'Enter this code on the verification page to finish signing in.',
        url: 'https://device.example',
        code: 'WXYZ-1234',
      },
      { message: 'Exchanging the code' },
      { message: 'Signing in…' },
    ])
  })

  it('restates every pi-ai prompt, carrying the per-prompt withdrawal signal', async () => {
    const ctx = await harness()
    const withdraw = new AbortController()
    const prompts: AuthPrompt[] = [
      { type: 'text', message: 'Your workspace', placeholder: 'acme' },
      { type: 'secret', message: 'Paste the key' },
      { type: 'secret', message: 'Paste the token', placeholder: 'sk-…' },
      { type: 'select', message: 'Which account?', options: [{ id: 'a', label: 'Work' }] },
      // The manual-code question a browser callback can win the race against.
      { type: 'manual_code', message: 'Paste the code', signal: withdraw.signal },
    ]

    const ui = await attempt(ctx, async (interaction) => {
      for (const prompt of prompts) await interaction.prompt(prompt)
    })

    expect(ui.prompts).toEqual([
      { kind: 'text', message: 'Your workspace', placeholder: 'acme' },
      { kind: 'secret', message: 'Paste the key' },
      { kind: 'secret', message: 'Paste the token', placeholder: 'sk-…' },
      { kind: 'select', message: 'Which account?', options: [{ id: 'a', label: 'Work' }] },
      { kind: 'text', message: 'Paste the code', signal: withdraw.signal },
    ])
  })

  it('hands the flow the attempt-wide cancellation signal', async () => {
    const ctx = await harness()
    let seen: AbortSignal | undefined
    const controller = new AbortController()
    login.mockImplementation((_id: string, _type: AuthType, interaction: AuthInteraction) => {
      seen = interaction.signal
      controller.abort()
      return new Promise(() => {})
    })

    await expect(ctx.authorization.begin({
      key: CODEX,
      interaction: surface(),
      signal: controller.signal,
    })).resolves.toEqual({ status: 'cancelled' })
    expect(seen?.aborted).toBe(true)
  })
})
