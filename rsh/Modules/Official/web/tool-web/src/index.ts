/**
 * Model-facing `web_search` and `web_fetch` tools over `ctx.web`. This package owns schemas,
 * validation, prompt guidance, limits, and presentation, never concrete providers. Enablement
 * controls tool registration; an enabled tool remains visible when its provider is unavailable
 * and fails with a structured error at execution time.
 * @module @deepseek-ai/dsh-tool-web
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { applyWebSearchTool } from './search.ts'
import { assertToolWebLimits, type Config, type ResolvedConfig } from './config.ts'
import { applyWebFetchTool } from './fetch.ts'

export { applyWebSearchTool, presentSearchCall, presentSearchResult } from './search.ts'
export { WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS } from './search-core.ts'
export { formatSearchOutput, searchMetaFromValue, searchMetaFromResult } from './search-core.ts'
export type { WebSearchMeta } from './search-core.ts'
export { applyWebFetchTool, presentFetchCall, presentFetchResult } from './fetch.ts'
export { formatFetchOutput, parseFetchArgs, fetchMetaFromValue, fetchMetaFromResult } from './fetch-core.ts'
export type { WebFetchMeta } from './fetch-core.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-web'

/** Services required by the web tool suite. */
export const inject = ['tools', 'web', 'systemPrompt']

export { Config, DEFAULT_FETCH_MAX_OUTPUT_CHARS, DEFAULT_WEB_TOOL_TIMEOUT_MS } from './config.ts'

/**
 * Register the enabled web tools. `search`/`fetch` default to true; a product
 * that wants only one disables the other in config. Each tool's cooperative
 * timeout budget (`fetchTimeoutMs`/`searchTimeoutMs`, default 30000) is resolved
 * here and attached to the tool as `ToolDefinition.timeoutMs` for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce. The tools' disposers are
 * fiber-scoped (the effect-based registries clean up on dispose), so no manual
 * teardown is needed.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertToolWebLimits(resolved)
  if (resolved.search) {
    applyWebSearchTool(ctx, resolved.searchMaxResults, resolved.searchMaxQueries, resolved.searchTimeoutMs, resolved.fetch)
  }
  if (resolved.fetch) applyWebFetchTool(ctx, resolved.fetchTimeoutMs, resolved.fetchMaxOutputChars)
}
