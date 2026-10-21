/**
 * Native installation of the DeepSeek search provider. It registers into the selected `web`
 * service, projects the same Settings section and credential reference per search, and records the
 * same secret-free Session event before dispatch as the Cordis plugin.
 * @module @deepseek-ai/dsh-web-search-deepseek/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import type {} from '@deepseek-ai/dsh-settings-definition/native'
import type {} from '@deepseek-ai/dsh-web/native'
import {
  Config,
  recordDeepSeekSearchRequest,
  resolveDeepSeekOptions,
  WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE,
} from './config.ts'
import { DeepSeekSearchProvider, type DeepSeekSearchProviderOptions } from './provider.ts'

export { Config, recordDeepSeekSearchRequest, resolveDeepSeekOptions, SEARCH_BASE_URL_ENV,
  WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE } from './config.ts'
export { DeepSeekSearchProvider, DEEPSEEK_PROVIDER_ID } from './provider.ts'

/**
 * Validate native configuration with the Cordis schema and reject fields it does not declare.
 * @param input - untrusted profile configuration.
 * @returns the validated configuration.
 */
function resolveConfig(input: unknown): Config {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TypeError('web-search-deepseek: native configuration must be an object')
  }
  for (const key of Object.keys(input ?? {})) {
    if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) {
      throw new TypeError(`web-search-deepseek: unknown native configuration field ${key}`)
    }
  }
  return Config(input ?? {})
}

/** Register the DeepSeek search provider; removal cancels and drains its admitted searches. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-web-search-deepseek', targets: ['host'],
  requires: ['web', 'launchEnvironment'], optional: ['settings', 'credentials'], provides: [],
  resolve(input) {
    const base = resolveConfig(input)
    const section = { ...input as Record<string, unknown> | undefined }
    let current = (): Config => base
    return (context) => {
      const settings = context.optional('settings')
      if (settings !== undefined) {
        const selection = settings.register<typeof WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE, Config>(
          WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE, section, value => Config(value), undefined, { schema: Config, applies: 'live' })
        current = () => selection.get()
        context.own(() => { selection.dispose() })
      }
      const service = context.require('web')
      const optionsFor = (): DeepSeekSearchProviderOptions => resolveDeepSeekOptions(current(), {
        environment: context.require('launchEnvironment'),
        credentials: context.optional('credentials'),
      })
      const registered = new DeepSeekSearchProvider(optionsFor)
      context.effect(service.registerSearchProvider({
        id: registered.id,
        available: () => registered.available(),
        search: (request, operation) => new DeepSeekSearchProvider(() => ({
          ...optionsFor(),
          recordRequest: requestFacts => recordDeepSeekSearchRequest(operation, requestFacts),
        })).search(request, operation.signal),
      }))
    }
  },
}
