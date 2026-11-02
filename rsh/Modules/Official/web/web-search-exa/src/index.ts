/**
 * Exa-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @redspark/rsh-web-search-exa
 */

import type { Context } from '@redspark/cordis'
import { launchEnvironmentOf } from '@redspark/rsh-launch-environment'
import type {} from '@redspark/rsh-web'
import { ExaSearchProvider } from './provider.ts'
import { resolveExaOptions, type Config } from './config.ts'

export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
} from './provider.ts'
export type { ExaSearchProviderOptions } from './provider.ts'
export { Config } from './config.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Register the Exa search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new ExaSearchProvider(resolveExaOptions(config, launchEnvironmentOf(ctx))))
}
