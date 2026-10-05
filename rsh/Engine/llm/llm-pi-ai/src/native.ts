/** Native pi-ai Provider using the shared catalog, profiles, auth and HTTP adapter. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAdapterModel } from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import type {} from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-settings/native'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm/native'
import { PiAiAdapter } from './adapter.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import { authContextFrom, credentialStoreFrom } from './auth-core.ts'

/** Publish the pi-ai adapter with the current native settings profiles. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-llm-pi-ai', targets: ['host'],
  requires: ['credentials', 'launchEnvironment'], optional: ['attachments', 'fs', 'settings'], provides: ['model'],
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
      if (settings !== undefined) {
        const selection = settings.register<Config>('llm-pi-ai', { providers: base.providers ?? {} }, (value) => {
          const config = Config(value)
          resolveProfiles(config.providers, 'deferred')
          return config
        }, assertServiceable)
        profiles = resolveProfiles(selection.get().providers, 'deferred')
        const unwatch = selection.watch((next) => { profiles = resolveProfiles(next.providers, 'deferred') })
        context.own(() => { unwatch(); selection.dispose() })
      }
      const adapter = new PiAiAdapter({
        profiles: () => profiles,
        auth: { credentials: credentialStoreFrom(credentials), authContext: authContextFrom(credentials, environment) },
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
      const model = new NativeAdapterModel(adapter, context.signal)
      context.own(() => model.close())
      context.provide('model', model)
    }
  },
}
