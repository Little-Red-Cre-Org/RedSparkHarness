/** Native pi-ai Provider using the shared catalog, profiles, auth and HTTP adapter. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-authorization/native'
import { NativeAdapterModel } from '@deepseek-ai/dsh-native-model-execution/native'
import { NativeAdapterModelDirectory } from '@deepseek-ai/dsh-native-model-execution/adapter-directory'
import { credentialKey, credentialKeyScope } from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import type {} from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-settings-definition/native'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm/native'
import { PiAiAdapter } from './adapter.ts'
import { NativeAccountsProvider } from './accounts.ts'
export type { AccountBalance, AccountKey, AccountSummary, AccountUsage, NativeAccounts, Quota, QuotaWindow } from './accounts.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import { authContextFrom, credentialStoreFrom } from './auth-core.ts'
import { createPiAiFlows } from './login-core.ts'

const CODEX_ACCOUNT_KEY = credentialKey('llm-pi-ai', 'openai-codex')

/** Publish the pi-ai adapter with the current native settings profiles. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-llm-pi-ai', targets: ['host'],
  requires: ['credentials', 'launchEnvironment'], optional: ['attachments', 'fs', 'settings', 'authorization'], provides: ['model', 'modelDirectory', 'accounts'],
  resolve(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new Error('llm-pi-ai: native configuration must be an object with providers')
    }
    for (const key of Object.keys(input)) {
      if (key !== 'providers') throw new Error(`llm-pi-ai: unknown native configuration field ${key}`)
    }
    const base = Config(input)
    let profiles = resolveProfiles(base.providers)
    return (context) => {
      const credentials = context.require('credentials')
      const environment = context.require('launchEnvironment')
      const attachments = context.optional('attachments')
      const fs = context.optional('fs')
      const settings = context.optional('settings')
      const authorization = context.optional('authorization')
      const auth = { credentials: credentialStoreFrom(credentials), authContext: authContextFrom(credentials, environment) }
      if (authorization !== undefined) {
        for (const flow of createPiAiFlows(auth)) context.effect(authorization.registerFlow(flow))
      }
      if (settings !== undefined) {
        const selection = settings.register<'llm-pi-ai', Config>('llm-pi-ai', { providers: base.providers ?? {} }, (value) => {
          const config = Config(value)
          resolveProfiles(config.providers, 'deferred')
          return config
        }, assertServiceable, { schema: Config, applies: 'live' })
        profiles = resolveProfiles(selection.get().providers, 'deferred')
        const unwatch = selection.watch((next) => { profiles = resolveProfiles(next.providers, 'deferred') })
        context.own(() => { unwatch(); selection.dispose() })
      }
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
      })
      context.own(() => { adapter.dispose() })
      context.provide('accounts', new NativeAccountsProvider(credentials, adapter, context.signal))
      const model = new NativeAdapterModel(adapter, context.signal)
      context.own(() => model.close())
      const directory = new NativeAdapterModelDirectory(adapter, () => [...profiles.keys()], context.signal)
      context.own(() => directory.dispose())
      context.on('credentials/record-updated', async (key) => {
        if (credentialKeyScope(key) === 'llm-pi-ai') adapter.invalidate()
        if (key === CODEX_ACCOUNT_KEY) {
          await context.events.parallel(context.scope, 'accounts/changed', key)
        }
      })
      context.provide('modelDirectory', directory)
      context.provide('model', model)
    }
  },
}
