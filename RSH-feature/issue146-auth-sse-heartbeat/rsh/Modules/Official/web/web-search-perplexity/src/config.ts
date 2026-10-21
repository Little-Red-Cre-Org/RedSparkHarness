/**
 * Framework-free configuration for the Perplexity search provider, shared by its Cordis plugin and
 * native installation.
 * @module @deepseek-ai/dsh-web-search-perplexity/config
 */

import z from '@deepseek-ai/schemastery'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import {
  PERPLEXITY_DEFAULT_BASE_URL,
  PERPLEXITY_DEFAULT_MAX_TOKENS,
  PERPLEXITY_DEFAULT_MODEL,
  type PerplexitySearchProviderOptions,
} from './provider.ts'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Perplexity API key. Falls back to `$PERPLEXITY_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
  searchRecency: z.union(['day', 'week', 'month', 'year'] as const),
})

/**
 * Project one config into provider options, filling the key from the launch environment.
 * @param config - schemastery-validated configuration.
 * @param environment - the launch environment snapshot.
 * @returns options for the Perplexity provider.
 */
export function resolvePerplexityOptions(config: Config, environment: LaunchEnvironmentSnapshot): PerplexitySearchProviderOptions {
  return {
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? environment.get('PERPLEXITY_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? PERPLEXITY_DEFAULT_BASE_URL,
    model: config.model ?? PERPLEXITY_DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? PERPLEXITY_DEFAULT_MAX_TOKENS,
    ...config.searchRecency !== undefined ? { searchRecency: config.searchRecency } : {},
  }
}
