/**
 * Native installation of the Perplexity search provider. It registers into the selected `web` service
 * with the same configuration, launch-environment key fallback, and provider id as the Cordis plugin.
 * @module @deepseek-ai/dsh-web-search-perplexity/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import type {} from '@deepseek-ai/dsh-web/native'
import { Config, resolvePerplexityOptions } from './config.ts'
import { PerplexitySearchProvider } from './provider.ts'

export { Config, resolvePerplexityOptions } from './config.ts'
export { PerplexitySearchProvider, PERPLEXITY_PROVIDER_ID } from './provider.ts'

/**
 * Validate native configuration with the Cordis schema and reject fields it does not declare.
 * @param input - untrusted profile configuration.
 * @returns the validated configuration.
 */
function resolveConfig(input: unknown): Config {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TypeError('web-search-perplexity: native configuration must be an object')
  }
  for (const key of Object.keys(input ?? {})) {
    if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) {
      throw new TypeError(`web-search-perplexity: unknown native configuration field ${key}`)
    }
  }
  return Config(input ?? {})
}

/** Register the Perplexity search provider; removal cancels and drains its admitted searches. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-web-search-perplexity', targets: ['host'],
  requires: ['web', 'launchEnvironment'], optional: [], provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const provider = new PerplexitySearchProvider(resolvePerplexityOptions(config, context.require('launchEnvironment')))
      context.effect(context.require('web').registerSearchProvider({
        id: provider.id,
        available: () => provider.available(),
        search: (request, operation) => provider.search(request, operation.signal),
      }))
    }
  },
}
