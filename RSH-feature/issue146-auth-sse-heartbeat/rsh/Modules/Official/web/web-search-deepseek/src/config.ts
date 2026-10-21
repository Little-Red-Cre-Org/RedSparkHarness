/**
 * Framework-free configuration for the DeepSeek search provider, shared by its Cordis plugin and
 * native installation.
 * @module @deepseek-ai/dsh-web-search-deepseek/config
 */

import z from '@deepseek-ai/schemastery'
import { credentialRef, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import {
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  type DeepSeekSearchProviderOptions,
} from './provider.ts'

/** Credential reference resolved when configuration names none. */
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  baseURL?: string
  /** Anthropic-format model name. Defaults to `deepseek-v4-flash`. */
  model?: string
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  apiVersion?: string
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  model: z.string().default(DEEPSEEK_DEFAULT_MODEL),
  apiVersion: z.string().default(DEEPSEEK_DEFAULT_API_VERSION),
  maxTokens: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_TOKENS),
  maxUses: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_USES),
})

/**
 * Environment variable naming this provider's endpoint. Deliberately distinct
 * from `$DEEPSEEK_BASE_URL`, which belongs to the chat-completions adapter:
 * search speaks the Anthropic-compatible Messages API, so one variable cannot
 * serve both.
 */
export const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE = 'web-search-deepseek'

/** Services a DeepSeek search resolves per operation. */
export interface DeepSeekSearchEnvironment {
  /** The immutable launch environment. */
  readonly environment: LaunchEnvironmentSnapshot
  /** The selected credential service, when one is installed. */
  readonly credentials?: Pick<NativeCredentials, 'resolve'> | undefined
  /** Persist the secret-free request before dispatch; a rejection prevents dispatch. */
  readonly recordRequest?: DeepSeekSearchProviderOptions['recordRequest']
}

/**
 * Project one resolved section into the options the provider serves its next search with.
 * Environment fallbacks stay here rather than in the provider: every value it reads is already
 * fully defaulted.
 * @param config - the currently authoritative section.
 * @param services - launch environment, credential resolution, and request recording.
 * @returns options for one search.
 */
export function resolveDeepSeekOptions(config: Config, services: DeepSeekSearchEnvironment): DeepSeekSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      if (services.credentials !== undefined) return (await services.credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = services.environment.get(apiKeyEnv)?.value
      return ambient !== undefined && ambient.length > 0 ? ambient : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? services.environment.get(SEARCH_BASE_URL_ENV)?.value ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: config.model ?? DEEPSEEK_DEFAULT_MODEL,
    apiVersion: config.apiVersion ?? DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: config.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? DEEPSEEK_DEFAULT_MAX_USES,
    ...services.recordRequest === undefined ? {} : { recordRequest: services.recordRequest },
  }
}

/** The exact Session event recorded before one auxiliary DeepSeek search dispatch. */
export const DEEPSEEK_SEARCH_REQUEST_EVENT = 'web/deepseek-search-llm-request' as const

/**
 * Record the secret-free request on the consuming invocation's Session.
 * @param operation - the invocation that owns the search.
 * @param request - the exact request about to be dispatched.
 */
export function recordDeepSeekSearchRequest(
  operation: Pick<NativeToolExecution, 'appendEvent'>,
  request: Parameters<NonNullable<DeepSeekSearchProviderOptions['recordRequest']>>[0],
): Promise<void> {
  return operation.appendEvent(DEEPSEEK_SEARCH_REQUEST_EVENT, request).then(() => undefined)
}
