/**
 * Register a DeepSeek-backed provider in `ctx.web`. It calls the Anthropic-compatible Messages API
 * with native `web_search_20250305`. The provider reuses `DEEPSEEK_API_KEY` but not
 * `DEEPSEEK_BASE_URL`, because search and chat-completions use different bases.
 * @module @deepseek-ai/dsh-web-search-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
import type {} from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import { DeepSeekSearchProvider } from './provider.ts'
import { Config, resolveDeepSeekOptions, WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE } from './config.ts'

export {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PROVIDER_ID,
} from './provider.ts'
export type { DeepSeekSearchLlmRequest, DeepSeekSearchProviderOptions } from './provider.ts'
export { Config, SEARCH_BASE_URL_ENV, WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE } from './config.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-deepseek'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Register the DeepSeek search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => { current = source },
      // The registration carries no resolved value: the provider projects the
      // section per search, so a committed change needs no re-registration.
      onChange: () => {},
    })
  })
  ctx.web.registerSearchProvider(new DeepSeekSearchProvider(() => resolveDeepSeekOptions(current(), {
    environment: launchEnvironmentOf(ctx),
    credentials: ctx.get('credentials'),
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request)
    },
  })))
}
