/**
 * Native installation of the anonymous public HTTP(S) fetch provider. It registers into the
 * selected `web` service with the same limits, destination policy, and provider id as the Cordis
 * plugin.
 * @module @deepseek-ai/dsh-web-fetch-http/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-web/native'
import { Config, resolveHttpFetchLimits } from './config.ts'
import { HttpFetchProvider } from './provider.ts'

export { Config, DEFAULT_USER_AGENT, resolveHttpFetchLimits } from './config.ts'
export { HttpFetchProvider, LOCAL_FETCH_PROVIDER_ID } from './provider.ts'
export type { HttpFetchLimits, HttpFetchResolver } from './provider.ts'

/**
 * Validate native configuration with the Cordis schema and reject fields it does not declare.
 * @param input - untrusted profile configuration.
 * @returns the defaulted configuration.
 */
function resolveConfig(input: unknown): Config {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TypeError('web-fetch-http: native configuration must be an object')
  }
  for (const key of Object.keys(input ?? {})) {
    if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) {
      throw new TypeError(`web-fetch-http: unknown native configuration field ${key}`)
    }
  }
  return Config(input ?? {})
}

/** Register the `http` fetch provider; removal cancels and drains its admitted fetches. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-web-fetch-http', targets: ['host'],
  requires: ['web'], optional: [], provides: [],
  resolve(input) {
    const limits = resolveHttpFetchLimits(resolveConfig(input))
    return (context) => {
      const provider = new HttpFetchProvider(limits)
      context.effect(context.require('web').registerFetchProvider({
        id: provider.id,
        available: () => provider.available(),
        fetch: (request, operation) => provider.fetch(request, operation.signal),
      }))
    }
  },
}
