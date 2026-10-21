/**
 * Native installation of the Exa search provider. It registers into the selected `web` service
 * with the same configuration, launch-environment key fallback, and provider id as the Cordis plugin.
 * @module @deepseek-ai/dsh-web-search-exa/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import type {} from '@deepseek-ai/dsh-web/native'
import { Config, resolveExaOptions } from './config.ts'
import { ExaSearchProvider } from './provider.ts'

export { Config, resolveExaOptions } from './config.ts'
export { ExaSearchProvider, EXA_PROVIDER_ID } from './provider.ts'

/**
 * Validate native configuration with the Cordis schema and reject fields it does not declare.
 * @param input - untrusted profile configuration.
 * @returns the validated configuration.
 */
function resolveConfig(input: unknown): Config {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TypeError('web-search-exa: native configuration must be an object')
  }
  for (const key of Object.keys(input ?? {})) {
    if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) {
      throw new TypeError(`web-search-exa: unknown native configuration field ${key}`)
    }
  }
  return Config(input ?? {})
}

/** Register the Exa search provider; removal cancels and drains its admitted searches. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-web-search-exa', targets: ['host'],
  requires: ['web', 'launchEnvironment'], optional: [], provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const provider = new ExaSearchProvider(resolveExaOptions(config, context.require('launchEnvironment')))
      context.effect(context.require('web').registerSearchProvider({
        id: provider.id,
        available: () => provider.available(),
        search: (request, operation) => provider.search(request, operation.signal),
      }))
    }
  },
}
