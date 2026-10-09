/**
 * Native web access capability: one scoped search/fetch provider registry with the same
 * registration-order-independent selection, `maxResults` enforcement, and `WebError` codes as the
 * Cordis `ctx.web` service. A provider removal closes its admission, cancels its admitted
 * operations, and resolves after they settle.
 * @module @deepseek-ai/dsh-web/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import { assertUniqueProvider, capSources, resolveProvider } from './selection.ts'
import type { WebFetchRequest, WebFetchResult, WebSearchRequest, WebSearchResult } from './types.ts'

export { WebError } from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'
export { capSources, resolveProvider } from './selection.ts'
export type { ProviderSelection, ResolvableProvider } from './selection.ts'

/**
 * Per-call facts a native provider receives from the consuming invocation. `appendEvent` persists a
 * provider-owned Session event before auxiliary model-visible input leaves the process.
 */
export type NativeWebOperation = Pick<NativeToolExecution, 'signal' | 'appendEvent'>

/** A native search-capable backend; `id` is unique within the search capability kind. */
export interface NativeWebSearchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /**
   * Run one search.
   * @param request - one query and its optional source bound.
   * @param operation - cancellation and Session recording of the consuming invocation.
   * @returns the provider's normalized search outcome.
   */
  search(request: WebSearchRequest, operation: NativeWebOperation): Promise<WebSearchResult>
}

/** A native fetch-capable backend; `id` is unique within the fetch capability kind. */
export interface NativeWebFetchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /**
   * Retrieve one URL; a non-2xx response resolves as a result.
   * @param request - the URL to retrieve.
   * @param operation - cancellation and Session recording of the consuming invocation.
   * @returns the provider's normalized fetch outcome.
   */
  fetch(request: WebFetchRequest, operation: NativeWebOperation): Promise<WebFetchResult>
}

/** Explicit provider pins; an omitted pin auto-selects exactly one usable provider. */
export interface NativeWebConfig {
  /** Search provider id; `$DSH_WEB_SEARCH_PROVIDER` from the process layer supplies it when omitted. */
  readonly searchProvider?: string
  /** Fetch provider id; `$DSH_WEB_FETCH_PROVIDER` from the process layer supplies it when omitted. */
  readonly fetchProvider?: string
}

/** Provider registries and selected execution offered to native web Consumers. */
export interface NativeWebService {
  /**
   * Register a search provider until the returned disposer settles.
   * @param provider - provider keyed by its `id`.
   * @returns a disposer that closes admission, cancels admitted searches, and awaits them.
   * @throws {@link WebError} `WEB_DUPLICATE_PROVIDER` when the id is registered.
   */
  registerSearchProvider(provider: NativeWebSearchProvider): () => Promise<void>
  /**
   * Register a fetch provider until the returned disposer settles.
   * @param provider - provider keyed by its `id`.
   * @returns a disposer that closes admission, cancels admitted fetches, and awaits them.
   * @throws {@link WebError} `WEB_DUPLICATE_PROVIDER` when the id is registered.
   */
  registerFetchProvider(provider: NativeWebFetchProvider): () => Promise<void>
  /**
   * Run one search through the provider selected at call time.
   * @param request - the query and optional source bound.
   * @param operation - consuming invocation cancellation and Session recording.
   * @returns the provider's result with `sources[]` capped to `request.maxResults`.
   * @throws {@link WebError} when no provider can be selected.
   */
  search(request: WebSearchRequest, operation: NativeWebOperation): Promise<WebSearchResult>
  /**
   * Retrieve one URL through the provider selected at call time.
   * @param request - the URL to retrieve.
   * @param operation - consuming invocation cancellation and Session recording.
   * @returns the provider's retrieval outcome.
   * @throws {@link WebError} when no provider can be selected.
   */
  fetch(request: WebFetchRequest, operation: NativeWebOperation): Promise<WebFetchResult>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { web: NativeWebService }
}

interface Registration<P> {
  readonly provider: P
  readonly controller: AbortController
  readonly pending: Set<Promise<unknown>>
}

class Registry<P extends { readonly id: string; available(): boolean }> {
  private readonly entries = new Map<string, Registration<P>>()

  constructor(private readonly configuredId: string | undefined) {}

  register(provider: P): () => Promise<void> {
    assertUniqueProvider(this.entries, provider.id)
    const entry: Registration<P> = { provider, controller: new AbortController(), pending: new Set() }
    this.entries.set(provider.id, entry)
    let disposal: Promise<void> | undefined
    return () => {
      disposal ??= (async () => {
        if (this.entries.get(provider.id) === entry) this.entries.delete(provider.id)
        entry.controller.abort(new Error(`web: provider "${provider.id}" was removed`))
        await Promise.allSettled([...entry.pending])
      })()
      return disposal
    }
  }

  async run<T>(operation: NativeWebOperation, invoke: (provider: P, operation: NativeWebOperation) => Promise<T>): Promise<T> {
    const providers = new Map([...this.entries].map(([id, entry]) => [id, entry.provider]))
    const selected = resolveProvider({ providers, ...this.configuredId === undefined ? {} : { configuredId: this.configuredId } })
    const entry = this.entries.get(selected.id) as Registration<P>
    const signal = AbortSignal.any([operation.signal, entry.controller.signal])
    const pending = invoke(entry.provider, { signal, appendEvent: operation.appendEvent })
    entry.pending.add(pending)
    try {
      return await pending
    } finally {
      entry.pending.delete(pending)
    }
  }
}

/**
 * Build one native web service. Exposed for hosts that construct providers directly.
 * @param config - resolved provider pins.
 * @returns the service with empty registries.
 */
export function createNativeWebService(config: NativeWebConfig): NativeWebService {
  const searches = new Registry<NativeWebSearchProvider>(config.searchProvider)
  const fetches = new Registry<NativeWebFetchProvider>(config.fetchProvider)
  return {
    registerSearchProvider: provider => searches.register(provider),
    registerFetchProvider: provider => fetches.register(provider),
    search: async (request, operation) => capSources(
      await searches.run(operation, (provider, admitted) => provider.search(request, admitted)), request.maxResults),
    fetch: (request, operation) => fetches.run(operation, (provider, admitted) => provider.fetch(request, admitted)),
  }
}

/**
 * Validate native web configuration before activation.
 * @param input - untrusted profile configuration.
 * @returns the validated provider pins.
 * @throws when the value is not an object, has an unknown field, or a pin is not a nonempty string.
 */
export function resolveNativeWebConfig(input: unknown): NativeWebConfig {
  if (input === undefined) return {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('web: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'searchProvider' && key !== 'fetchProvider') throw new TypeError(`web: unknown native configuration field ${key}`)
  }
  for (const key of ['searchProvider', 'fetchProvider'] as const) {
    const value = fields[key]
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new TypeError(`web: ${key} must be a nonempty string`)
    }
  }
  return Object.freeze({
    ...fields.searchProvider === undefined ? {} : { searchProvider: fields.searchProvider as string },
    ...fields.fetchProvider === undefined ? {} : { fetchProvider: fields.fetchProvider as string },
  })
}

function processPin(environment: LaunchEnvironmentSnapshot, name: string): string | undefined {
  return environment.getFrom(name, ['process'])?.value
}

/** Provide `web`; configured pins win over the same-named process environment overrides. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-web', targets: ['host'],
  requires: ['launchEnvironment'], optional: [], provides: ['web'],
  resolve(input) {
    const config = resolveNativeWebConfig(input)
    return (context) => {
      const environment = context.require('launchEnvironment')
      const searchProvider = config.searchProvider ?? processPin(environment, 'DSH_WEB_SEARCH_PROVIDER')
      const fetchProvider = config.fetchProvider ?? processPin(environment, 'DSH_WEB_FETCH_PROVIDER')
      context.provide('web', createNativeWebService({
        ...searchProvider === undefined ? {} : { searchProvider },
        ...fetchProvider === undefined ? {} : { fetchProvider },
      }))
    }
  },
}
