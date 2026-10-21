/**
 * Anonymous public HTTP(S) `WebFetchProvider` plugin. It contributes to the
 * `ctx.web` registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-fetch-http
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { HttpFetchProvider } from './provider.ts'
import { resolveHttpFetchLimits, type Config } from './config.ts'

export {
  LOCAL_FETCH_PROVIDER_ID,
  HttpFetchProvider,
} from './provider.ts'
export type { HttpFetchLimits, HttpFetchResolver } from './provider.ts'
export { Config, DEFAULT_USER_AGENT } from './config.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-http'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Register the local HTTP(S) fetch provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  ctx.web.registerFetchProvider(new HttpFetchProvider(resolveHttpFetchLimits(config)))
}
