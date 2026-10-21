/**
 * Framework-free provider selection and source capping shared by the Cordis and native web services.
 * @module @deepseek-ai/dsh-web/selection
 */

import type { WebSearchResult } from './types.ts'
import { WebError } from './types.ts'

/** A registered provider as seen by execution-time selection. */
export interface ResolvableProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
}

/** Selection inputs for execution-time provider resolution. */
export interface ProviderSelection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Resolve the selected provider without depending on registration order.
 * @param selection - the configured id, if any, and the registered providers.
 * @returns the configured usable provider, or the single usable provider when none is configured.
 * @throws {@link WebError} `WEB_PROVIDER_CONFIGURED_MISSING`, `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`,
 *   `WEB_PROVIDER_UNAVAILABLE`, or `WEB_PROVIDER_AMBIGUOUS`.
 */
export function resolveProvider<P extends ResolvableProvider>(selection: ProviderSelection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/**
 * Reject a second provider id before it replaces the registered one.
 * @param providers - providers already registered for the capability kind.
 * @param id - the id being registered.
 * @throws {@link WebError} `WEB_DUPLICATE_PROVIDER` when `id` is already registered.
 */
export function assertUniqueProvider(providers: ReadonlyMap<string, unknown>, id: string): void {
  if (providers.has(id)) {
    throw new WebError(`a web provider with id "${id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
  }
}

/**
 * Enforce `maxResults` on a search result.
 * @param result - the provider's search outcome.
 * @param maxResults - the request's source bound; omitted means unbounded.
 * @returns the unchanged result, or a copy whose `sources[]` is truncated with `truncated: true`.
 */
export function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}
