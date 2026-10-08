/**
 * Framework-free configuration for the Exa search provider, shared by its Cordis plugin and native
 * installation.
 * @module @deepseek-ai/dsh-web-search-exa/config
 */

import z from '@deepseek-ai/schemastery'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  type ExaSearchProviderOptions,
} from './provider.ts'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Exa API key. Falls back to `$EXA_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  searchType: z.union(['auto', 'keyword', 'neural'] as const),
  numResults: z.number().step(1).min(1),
  highlightsPerResult: z.number().step(1).min(1),
})

/**
 * Project one config into provider options, filling the key from the launch environment.
 * @param config - schemastery-validated configuration.
 * @param environment - the launch environment snapshot.
 * @returns options for the Exa provider.
 */
export function resolveExaOptions(config: Config, environment: LaunchEnvironmentSnapshot): ExaSearchProviderOptions {
  return {
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? environment.get('EXA_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? EXA_DEFAULT_BASE_URL,
    searchType: config.searchType ?? EXA_DEFAULT_SEARCH_TYPE,
    highlightsPerResult: config.highlightsPerResult ?? EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }
}
