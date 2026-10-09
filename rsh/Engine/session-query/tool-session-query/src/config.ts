/** Cordis-free session-query tool limits shared by both installers. */

import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Default maximum authorized hits returned by one search call. */
export const DEFAULT_MAX_SEARCH_RESULTS = 100

/** Default cooperative deadline for either full-text search tool. */
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000

/** Deployment-owned search count and timeout bounds. */
export interface SessionQueryToolConfig {
  /** Maximum authorized hits returned by one search call. Defaults to 100. */
  maxSearchResults?: number
  /** Cooperative full-text search deadline in milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
}

/** Resolved search count and timeout used by one installed Consumer. */
export interface ResolvedSessionQueryToolConfig {
  readonly maxSearchResults: number
  readonly searchTimeoutMs: number
}

/** Resolve and validate limits before either Consumer installs its tools.
 * @param input - Cordis config or Native profile config.
 * @returns validated search count and timeout.
 */
export function resolveSessionQueryToolConfig(input: unknown): ResolvedSessionQueryToolConfig {
  if (input === undefined) input = {}
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('tool-session-query: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'maxSearchResults' && key !== 'searchTimeoutMs') {
      throw new TypeError(`tool-session-query: unknown configuration field ${key}`)
    }
  }
  const maxSearchResults = fields.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS
  const searchTimeoutMs = fields.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
  if (!Number.isSafeInteger(maxSearchResults) || (maxSearchResults as number) < 1) {
    throw new TypeError('tool-session-query: maxSearchResults must be a positive safe integer')
  }
  if (!Number.isInteger(searchTimeoutMs) || (searchTimeoutMs as number) < 1 || (searchTimeoutMs as number) > MAX_TIMER_DELAY_MS) {
    throw new TypeError(
      `tool-session-query: searchTimeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return { maxSearchResults: maxSearchResults as number, searchTimeoutMs: searchTimeoutMs as number }
}
