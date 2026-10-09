/**
 * Framework-free configuration of the web tools, shared by the Cordis plugin and native installation.
 * @module @deepseek-ai/dsh-tool-web/config
 */

import z from '@deepseek-ai/schemastery'
import { WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS } from './search-core.ts'

/** Default cooperative tool-call timeout budget (ms) for the web tools. */
export const DEFAULT_WEB_TOOL_TIMEOUT_MS = 30_000

/**
 * Default cap on one `web_fetch` output and on source characters converted
 * synchronously. This leaves headroom above the local provider's default
 * 100,000-character body cap while bounding custom providers and rendered output.
 */
export const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 200_000

/** Plugin config: which web tools to register, search bounds, per-tool budgets, and the fetch output cap. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  fetch?: boolean
  /** Upper bound on sources returned by one `web_search` call. */
  searchMaxResults?: number
  /** Upper bound on queries accepted by one `web_search` call. */
  searchMaxQueries?: number
  /** Cooperative timeout budget (ms) for `web_fetch`. Defaults to 30000. */
  fetchTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `web_search`. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Cap on source characters converted and complete `web_fetch` output characters. Defaults to 200000. */
  fetchMaxOutputChars?: number
}

export const Config: z<Config> = z.object({
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
  searchMaxResults: z.number().default(WEB_SEARCH_MAX_RESULTS),
  searchMaxQueries: z.number().default(WEB_SEARCH_MAX_QUERIES),
  fetchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  searchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  fetchMaxOutputChars: z.number().default(DEFAULT_FETCH_MAX_OUTPUT_CHARS),
})

/** Complete config after schemastery applies every field default. */
export type ResolvedConfig = Required<Config>

/**
 * Assert that one configured count, timeout, or character cap is a positive integer.
 * @param name - the configuration field, named in the error.
 * @param value - the configured value.
 * @throws when `value` is not a positive integer.
 */
export function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-web: ${name} must be a positive integer`)
  }
}

/**
 * Assert every configured count, timeout, and character cap before any tool registers.
 * @param resolved - configuration with every schema default applied.
 */
export function assertToolWebLimits(resolved: ResolvedConfig): void {
  assertPositiveInteger('searchMaxResults', resolved.searchMaxResults)
  assertPositiveInteger('searchMaxQueries', resolved.searchMaxQueries)
  assertPositiveInteger('fetchTimeoutMs', resolved.fetchTimeoutMs)
  assertPositiveInteger('searchTimeoutMs', resolved.searchTimeoutMs)
  assertPositiveInteger('fetchMaxOutputChars', resolved.fetchMaxOutputChars)
}
