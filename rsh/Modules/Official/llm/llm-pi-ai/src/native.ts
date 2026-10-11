/** Native pi-ai Provider using the shared catalog, profiles, auth and HTTP adapter. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeModelSettings } from './model-settings.ts'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm/native'
import type {} from '@deepseek-ai/dsh-authorization/native'
import type {} from '@deepseek-ai/dsh-deepseek-account/native'
import { NativeAdapterModel } from '@deepseek-ai/dsh-native-model-execution/native'
import { NativeAdapterModelDirectory } from '@deepseek-ai/dsh-native-model-execution/adapter-directory'
import { credentialKey, credentialKeyId, credentialKeyScope } from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import type {} from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-fs/native'
import type { NativeSettingsScope } from '@deepseek-ai/dsh-settings-definition/native'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm/native'
import { PiAiAdapter } from './adapter.ts'
import { NativeAccountsProvider } from './accounts.ts'
export type { AccountBalance, AccountKey, AccountSummary, AccountUsage, NativeAccounts, Quota, QuotaWindow } from './accounts.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import type { PiAiProviderProfile } from './config.ts'
import { authContextFrom, credentialStoreFrom } from './auth-core.ts'
import { createPiAiFlows } from './login-core.ts'
import { configurableProviderEntries } from './configurable-providers.ts'
import { discoverModels } from './discovery.ts'
import type { StoredModelDiscoveryProfile } from './discovery.ts'

const CODEX_ACCOUNT_KEY = credentialKey('llm-pi-ai', 'openai-codex')
const DEEPSEEK_ACCOUNT_KEY = credentialKey('deepseek-account', 'default')
const DEEPSEEK_ACCOUNT_ROUTE = 'deepseek-account'
const DEEPSEEK_ACCOUNT_BASE_URL = 'https://api.deepseek.com/anthropic'
const SETTINGS_NAMESPACE = 'llm-pi-ai'
const DEEPSEEK_ACCOUNT_PROFILE: PiAiProviderProfile = {
  displayName: 'DeepSeek Account',
  api: 'anthropic-messages',
  baseURL: DEEPSEEK_ACCOUNT_BASE_URL,
  models: [
    { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  ],
}

function profilesWithAccountRoutes(
  providers: NonNullable<Config['providers']>, codex: boolean, deepseekAccount: boolean,
): ReturnType<typeof resolveProfiles> {
  const routes = { ...providers }
  if (codex) routes['openai-codex'] ??= {}
  if (deepseekAccount) routes[DEEPSEEK_ACCOUNT_ROUTE] ??= DEEPSEEK_ACCOUNT_PROFILE
  return resolveProfiles(routes, 'deferred')
}

function deepseekAccountDestination(profile: Pick<PiAiProviderProfile, 'baseURL'>): string {
  return profile.baseURL ?? DEEPSEEK_ACCOUNT_BASE_URL
}

export type { NativeModelSettings } from './model-settings.ts'

/** Publish the pi-ai adapter with the current native settings profiles. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-llm-pi-ai', targets: ['host'],
  requires: ['credentials', 'launchEnvironment'],
  optional: ['attachments', 'fs', 'settings', 'authorization', 'deepseekAccount'],
  provides: ['model', 'modelDirectory', 'modelSettings', 'accounts'],
  resolve(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new Error('llm-pi-ai: native configuration must be an object with providers')
    }
    for (const key of Object.keys(input)) {
      if (key !== 'providers') throw new Error(`llm-pi-ai: unknown native configuration field ${key}`)
    }
    const base = Config(input)
    return async (context) => {
      const credentials = context.require('credentials')
      const environment = context.require('launchEnvironment')
      const attachments = context.optional('attachments')
      const fs = context.optional('fs')
      const settings = context.optional('settings')
      const authorization = context.optional('authorization')
      const deepseekAccount = context.optional('deepseekAccount')
      const auth = { credentials: credentialStoreFrom(credentials), authContext: authContextFrom(credentials, environment) }
      if (authorization !== undefined) {
        for (const flow of createPiAiFlows(auth)) context.effect(authorization.registerFlow(flow))
      }
      let providers: NonNullable<Config['providers']> = base.providers ?? {}
      let settingsSelection: NativeSettingsScope<Config> | undefined
      if (settings !== undefined) {
        const selection = settings.register<'llm-pi-ai', Config>('llm-pi-ai', { providers: base.providers ?? {} }, (value) => {
          const config = Config(value)
          resolveProfiles(config.providers, 'deferred')
          return config
        }, assertServiceable, { schema: Config, applies: 'live' })
        providers = selection.get().providers ?? {}
        settingsSelection = selection
        context.own(() => { selection.dispose() })
      }
      let credentialSnapshotsDirty = false
      let credentialSnapshotsReady = false
      let codexAvailable = false
      let deepseekAccountAvailable = false
      context.on('credentials/record-updated', async (key) => {
        if (!credentialSnapshotsReady) {
          if (key === CODEX_ACCOUNT_KEY || key === DEEPSEEK_ACCOUNT_KEY) credentialSnapshotsDirty = true
          return
        }
        if (credentialKeyScope(key) === 'llm-pi-ai') {
          if (key === CODEX_ACCOUNT_KEY) {
            const record = await credentials.describeRecord(CODEX_ACCOUNT_KEY)
            codexAvailable = record.configured && record.kind === 'grant'
            profiles = profilesWithAccountRoutes(providers, codexAvailable, deepseekAccountAvailable)
          }
          adapter.invalidate()
          await context.events.parallel(context.scope, 'llm/adapters-updated')
        }
        if (key === DEEPSEEK_ACCOUNT_KEY) {
          deepseekAccountAvailable = deepseekAccount !== undefined
            && await deepseekAccount.resolveToken(DEEPSEEK_ACCOUNT_BASE_URL) !== undefined
          profiles = profilesWithAccountRoutes(providers, codexAvailable, deepseekAccountAvailable)
          adapter.invalidate()
          await context.events.parallel(context.scope, 'llm/adapters-updated')
        }
        if (key === CODEX_ACCOUNT_KEY || key === DEEPSEEK_ACCOUNT_KEY) {
          await context.events.parallel(context.scope, 'accounts/changed', key)
        }
      })
      do {
        context.signal.throwIfAborted()
        // Reconcile account commits delivered while either snapshot is pending.
        credentialSnapshotsDirty = false
        const codexRecord = await credentials.describeRecord(CODEX_ACCOUNT_KEY)
        codexAvailable = codexRecord.configured && codexRecord.kind === 'grant'
        deepseekAccountAvailable = deepseekAccount !== undefined
          && await deepseekAccount.resolveToken(DEEPSEEK_ACCOUNT_BASE_URL, context.signal) !== undefined
        context.signal.throwIfAborted()
      } while (credentialSnapshotsDirty)
      // Settings watches do not replay; refresh the value before subscribing.
      if (settingsSelection !== undefined) providers = settingsSelection.get().providers ?? {}
      let profiles = profilesWithAccountRoutes(providers, codexAvailable, deepseekAccountAvailable)
      const adapter = new PiAiAdapter({
        profiles: () => profiles,
        auth,
        resolveAttachments: () => attachments,
        resolveImageAccess: (store, ref) => resolveImageAttachmentAccess(store, hostPath => fs?.processPathFromHostPath(hostPath), ref),
        async resolveApiKey(provider, profile) {
          if (profile.apiKeyEnv === undefined) return undefined
          const hit = await credentials.resolve(profile.apiKeyEnv)
          context.signal.throwIfAborted()
          if (hit === undefined || hit.value.length === 0) throw new LlmError(`llm-pi-ai: no credential for provider route "${provider}"; set ${profile.apiKeyEnv} in the launch environment or credential store`, 'MISSING_CREDENTIAL')
          return assertUsableApiKey(hit.value, 'llm-pi-ai', profile.apiKeyEnv)
        },
        async resolveRequestHeaders(provider, profile, signal) {
          if (provider !== DEEPSEEK_ACCOUNT_ROUTE) return undefined
          const token = await deepseekAccount?.resolveToken(deepseekAccountDestination(profile), signal)
          context.signal.throwIfAborted()
          if (token === undefined) throw new LlmError('Sign in to DeepSeek to use the account provider.', 'MISSING_CREDENTIAL')
          return { authorization: `Bearer ${token}`, 'x-dsh-auth-token': token }
        },
      })
      context.own(() => { adapter.dispose() })
      context.provide('accounts', new NativeAccountsProvider(credentials, context.signal, deepseekAccount))
      const model = new NativeAdapterModel(adapter, context.signal)
      context.own(() => model.close())
      const directory = new NativeAdapterModelDirectory(adapter, () => [...profiles.keys()], context.signal)
      context.own(() => directory.dispose())
      const discoveries = new Set<Promise<unknown>>()
      context.own(async () => { await Promise.allSettled(discoveries) })
      const modelSettings: NativeModelSettings = {
        configurableProviders: () => configurableProviderEntries(profiles),
        async firstAvailableAccountModel(signal) {
          const apiKeyRecords = new Set((await credentials.listRecords())
            .filter(record => record.kind === 'api-key' && credentialKeyScope(record.key) === SETTINGS_NAMESPACE)
            .map(record => credentialKeyId(record.key)))
          for (const profile of profiles.values()) {
            if (profile.apiKeyEnv !== undefined) {
              if ((await credentials.describe(profile.apiKeyEnv)).configured) return undefined
              continue
            }
            if (apiKeyRecords.has(profile.provider)) return undefined
            const apiKeyAuth = profile.piProvider?.auth.apiKey
            if (apiKeyAuth === undefined) continue
            const check = await apiKeyAuth.check?.({ ctx: auth.authContext, signal })
            signal.throwIfAborted()
            if (check !== undefined) {
              if (check.type === 'api_key') return undefined
              continue
            }
            const resolved = await apiKeyAuth.resolve({ ctx: auth.authContext, signal })
            signal.throwIfAborted()
            if (resolved?.auth.apiKey) return undefined
          }
          const deepseekProfile = profiles.get(DEEPSEEK_ACCOUNT_ROUTE)
          const deepseekAvailable = deepseekProfile !== undefined && deepseekAccount !== undefined
            && await deepseekAccount.resolveToken(deepseekAccountDestination(deepseekProfile), signal) !== undefined
          signal.throwIfAborted()
          const candidates = [
            ...(deepseekAvailable ? [DEEPSEEK_ACCOUNT_ROUTE] : []),
            ...(codexAvailable ? ['openai-codex'] : []),
          ]
          for (const provider of candidates) {
            const [model] = await adapter.listModels(provider, signal)
            if (model !== undefined) return { provider, model: model.id }
          }
          return undefined
        },
        discover(settingsNs, request, callerSignal) {
          const pending = discover(settingsNs, request, AbortSignal.any([callerSignal, context.signal]))
          discoveries.add(pending)
          void pending.finally(() => discoveries.delete(pending)).catch(() => undefined)
          return pending
        },
      }
      async function discover(
        settingsNs: string, request: LlmModelDiscoveryRequest, signal: AbortSignal,
      ): Promise<readonly LlmDiscoveredModel[]> {
        signal.throwIfAborted()
        if (settingsNs !== SETTINGS_NAMESPACE) {
          throw new LlmError(`no model discovery is registered for "${settingsNs}"`, 'NO_DISCOVERY')
        }
        if ((request.provider ?? '').length === 0 && (request.baseURL ?? '').length === 0) {
          throw new LlmError('model discovery needs a provider route or a baseURL', 'INVALID_DISCOVERY')
        }
        const storedProfile = (provider: string | undefined): StoredModelDiscoveryProfile | undefined => {
          if (provider === undefined) return undefined
          const profile = profiles.get(provider)
          if (profile === undefined) return undefined
          return {
            headers: profile.headers,
            async resolveApiKey() {
              if (profile.apiKeyEnv === undefined) return undefined
              const hit = await credentials.resolve(profile.apiKeyEnv)
              signal.throwIfAborted()
              if (hit === undefined || hit.value.length === 0) {
                throw new LlmError(
                  `llm-pi-ai: no credential for provider route "${provider}"; set ${profile.apiKeyEnv}`,
                  'MISSING_CREDENTIAL',
                )
              }
              return assertUsableApiKey(hit.value, 'llm-pi-ai', profile.apiKeyEnv)
            },
            ...provider === 'openai-codex'
              ? { resolveCodexAuth: (abortSignal?: AbortSignal) => adapter.getProviderAuth(provider, abortSignal) }
              : {},
          }
        }
        const discovered = await discoverModels({ ...request, signal }, () => storedProfile(request.provider))
        const seen = new Set<string>()
        return discovered.flatMap((model) => {
          if (typeof model.id !== 'string' || model.id.length === 0 || seen.has(model.id)) return []
          seen.add(model.id)
          return [{
            id: model.id,
            ...model.name === undefined ? {} : { name: model.name },
            ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
            ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
          }]
        })
      }
      context.provide('modelSettings', modelSettings)
      if (settingsSelection !== undefined) {
        const unwatch = settingsSelection.watch(async (next) => {
          providers = next.providers ?? {}
          profiles = profilesWithAccountRoutes(providers, codexAvailable, deepseekAccountAvailable)
          adapter.invalidate()
          await context.events.parallel(context.scope, 'llm/adapters-updated')
        })
        context.own(unwatch)
      }
      context.provide('modelDirectory', directory)
      context.provide('model', model)
      credentialSnapshotsReady = true
    }
  },
}
