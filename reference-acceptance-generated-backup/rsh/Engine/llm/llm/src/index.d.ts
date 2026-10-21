/**
 * LLM service: adapter registry with a waterfall-interceptable streaming call
 * API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
 * provider backends, and `BlockAssembler` for chunk assembly.
 *
 * @module @deepseek-ai/dsh-llm
 */
import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { GenerateOptions, LlmConfigurableProvider, LlmDiscoveredModel, LlmImageRequestPricing, LlmModelContext, LlmModelDiscoveryRequest, LlmModelInfo, LlmResolvedModelInfo, LlmProviderInfo, ModelModality, StreamChunk, SystemPromptUpdate } from './types.ts';
import type { ResolvedRetryPolicy } from './retry-policy.ts';
import type { LlmCallConfig, LlmCallConfigAdapterDefaults } from './call-config.ts';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment/types';
declare module '@deepseek-ai/dsh-typert-protocol/types' {
    interface RemoteErrorDetailsMap {
        /** A draft provider interrogation refused or failed. */
        'llm/model-discovery-rejected': {
            readonly settingsNs: string;
            readonly baseURL?: string;
        };
    }
}
export * from './attribution.ts';
export * from './brand.ts';
export * from './error.ts';
export * from './api-key.ts';
export * from './types.ts';
export * from './content.ts';
export * from './assistant-stream.ts';
export * from './message.ts';
export * from './retry-policy.ts';
export { BlockAssembler } from './assembler.ts';
export { callConfigEquals, isAgentLoopRequest, markAgentLoopRequest } from './call-config.ts';
export type { LlmCallConfig, LlmCallConfigAdapterDefaults } from './call-config.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        llm: LlmRuntime;
    }
    interface Events {
        /**
         * The provider topology changed: an adapter registered or unregistered
         * routes, or the configurable-provider directory gained or lost entries.
         * This payload-free registry notification fires at each commit point
         * (including registration disposal); consumers re-read `listProviders()`,
         * `listModels()`, or `listConfigurableProviders()` for the new state.
         * Observer failures are contained and cannot veto the registry mutation.
         * @mode emit
         */
        'llm/adapters-updated'(): void;
        /**
         * Waterfall around every streaming model call (retry, replay, routing).
         * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
         * adapter's stream, or yield your own chunks to short-circuit.
         * @param options - the full request. A LOOP-built request carries the
         *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
         *   (mutation throws): its content is a pure function of the session log (the
         *   reconstructability Agent Note), so listeners read it, never rewrite it.
         *   Hand-built calls do not carry that marker; their messages already obey
         *   the immutable creation contract.
         * @mode waterfall
         */
        'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
    }
}
/** One model call whose config and adapter registration were resolved together. */
export interface PreparedLlmCall {
    /** Detached, deep-frozen config with any adapter-owned default materialized. */
    readonly config: LlmCallConfig;
    /** Immutable retry policy captured with the adapter registration. */
    readonly retryPolicy: ResolvedRetryPolicy;
    /** Detached context metadata resolved with the registration-bound call. */
    readonly context?: LlmModelContext;
    /** Exact model modalities captured with the adapter dispatch generation. */
    readonly inputModalities?: readonly ModelModality[];
    /** Exact model system prompt update mode captured with the adapter dispatch generation. */
    readonly systemPromptUpdate?: SystemPromptUpdate;
    /** Config fields materialized by the captured adapter rather than proposed by the caller. */
    readonly adapterDefaults: LlmCallConfigAdapterDefaults;
    /**
     * Dispatch this call once through the registration captured during
     * preparation. The request's call-config fields must match {@link config};
     * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
     * @param options - fully assembled request carrying the prepared config.
     * @returns the chunk stream, including the `llm/stream` waterfall.
     */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export { LlmAdapter } from './adapter.ts';
export type { PreparedAdapterCall } from './adapter.ts';
import { LlmAdapter } from './adapter.ts';
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
export interface AdapterRegistrationHandle {
    /** Release every route this registration currently holds. */
    (): void;
    /**
     * Replace this registration's routes with `providers`, keeping the same
     * adapter instance. The candidate set is validated in full first — a
     * conflict with another adapter, an invalid name, or bad provider metadata
     * throws and leaves the current routes untouched — and the swap itself is
     * one synchronous section, so no request can observe a gap. An empty array
     * is legal here (a settings section that emptied holds zero routes while
     * staying registered), unlike an empty initial registration.
     *
     * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
     * has been released: its routes are gone and its disposer has already run,
     * so anything registered afterwards would have no owner left to release it.
     * @param providers - the complete next route set for this registration.
     */
    replace(providers: string[]): void;
}
/**
 * A live configurable-provider registration, disposable and atomically
 * replaceable — the directory counterpart of {@link AdapterRegistrationHandle}.
 */
export interface DirectoryRegistrationHandle {
    /** Withdraw every entry this registration currently holds. */
    (): void;
    /**
     * Replace this registration's entries with `entries`. The candidate set is
     * validated in full first — an entry another registration already declares,
     * a duplicate within the set, or invalid metadata throws and leaves the
     * current entries untouched — and the swap is one synchronous section, so no
     * reader observes a gap. An empty array is legal here, unlike an empty
     * initial registration.
     *
     * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
     * has been disposed.
     */
    replace(entries: readonly LlmConfigurableProvider[]): void;
}
/**
 * The abstract `llm` service: an adapter registry plus a streaming model-call
 * API, interceptable via the `llm/stream` waterfall.
 */
export declare class LlmRuntime extends TypertRemoteService {
    private adapters;
    private directory;
    private discoveries;
    constructor(ctx: Context);
    /** Notify topology observers without letting one broken listener veto the commit. */
    private emitAdaptersUpdated;
    /** Contained-listener diagnostic shared by the sync and async failure paths. */
    private warnAdaptersListenerFailure;
    /**
     * Register an adapter for the given provider routes. Throws `LlmError` with code
     * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
     * Disposed with the fiber.
     * @param providers - every provider route this adapter should serve.
     * @param adapter - the adapter that streams calls for those providers.
     * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
     */
    registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle;
    /**
     * Validate one candidate route set for `adapter`, treating routes this
     * registration already holds as available. Nothing is mutated: a rejected
     * candidate leaves the registry exactly as it was.
     */
    private prepareRoutes;
    /**
     * Swap this registration's routes for the prepared ones in one synchronous
     * section, so no observer can see the registry between the release and the
     * re-registration. The route set's one mutation point is also where
     * `llm/adapters-updated` is published, so a `replace` announces itself
     * exactly like a first registration.
     */
    private commitRoutes;
    /**
     * Describe provider routes with a registered adapter.
     * @returns detached provider metadata in registration order.
     */
    listProviders(): LlmProviderInfo[];
    /**
     * Declare provider routes an adapter plugin can activate through
     * configuration. Registration is all-or-nothing: an empty list, invalid
     * entry, or a provider already declared by any registration throws
     * `LlmError` without registering the rest. Disposed with the fiber.
     * @param entries - every configurable provider this plugin owns.
     * @returns a handle that withdraws all of them, and can atomically replace them.
     */
    registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle;
    /**
     * List every declared configurable provider, registered or dormant.
     * @returns detached directory entries in declaration order.
     */
    listConfigurableProviders(): LlmConfigurableProvider[];
    /**
     * Offer to interrogate provider endpoints on behalf of the settings
     * namespace this plugin owns. The namespace is the key because that is what
     * a configuration surface already holds from the configurable-provider
     * directory, and because a provider being *added* has no route to name yet.
     * Disposed with the fiber.
     * @param settingsNs - the namespace whose profiles this discovery serves.
     * @param discover - interrogates one endpoint and must honor the supplied signal.
     * @returns the disposer that withdraws the offer.
     */
    registerModelDiscovery(settingsNs: string, discover: (request: LlmModelDiscoveryRequest, signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>): () => void;
    /**
     * Interrogate one provider endpoint for the models it advertises. The
     * request describes a draft, not a stored route, so nothing here reads or
     * writes settings or credentials — the caller owns both, and the reply is
     * candidate metadata a surface may offer for adoption.
     * @param settingsNs - namespace whose registered discovery serves this draft.
     * @param request - the endpoint, protocol, and one-shot credential to use.
     * @param signal - caller cancellation.
     * @returns the advertised models, deduplicated in endpoint order.
     */
    discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest, signal?: AbortSignal): Promise<LlmDiscoveredModel[]>;
    /**
     * Remote adapter for one draft provider interrogation.
     * @param settingsNs - namespace whose registered discovery serves this draft.
     * @param request - endpoint, protocol, and one-shot credential to use.
     * @param signal - caller cancellation supplied by the Remote carrier.
     * @returns advertised models in endpoint order.
     * @throws RemoteError with `llm/model-discovery-rejected` when discovery refuses or fails.
     */
    remoteDiscoverModels(settingsNs: string, request: LlmModelDiscoveryRequest, signal: AbortSignal): Promise<LlmDiscoveredModel[]>;
    /**
     * Resolve the retry policy captured when one provider route was registered.
     * @param provider - registered provider route to inspect.
     * @returns the provider-owned policy, with normal defaults already resolved.
     */
    providerRetryPolicy(provider: string): ResolvedRetryPolicy;
    /**
     * Resolve provider-side request-image pricing for one exact route, or
     * `undefined` when the provider is unregistered or declares none. Unknown
     * providers degrade to `undefined` rather than throwing because callers
     * price durable history whose route may no longer be mounted.
     * @param provider - provider route named by a request header.
     * @param model - exact model id named by the same header.
     * @returns the owning adapter's image pricing for the route, when declared.
     */
    imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined;
    /**
     * Resolve the exact text one durable file occurrence contributes to every
     * provider request in the current execution environment.
     * @param ref - durable verbatim file reference from model history.
     * @returns the same deterministic handle text used at adapter dispatch.
     */
    fileRequestText(ref: FileAttachmentRef): string;
    /** Detach typed adapter-owned modality metadata. */
    private detachedModalities;
    /**
     * Discover models advertised by one registered provider. Catalog membership
     * is advisory and never changes routing or request validation.
     * @param provider - registered provider route to inspect.
     * @returns detached model metadata in adapter-preferred order.
     */
    listModels(provider: string): Promise<LlmModelInfo[]>;
    /**
     * Resolve and validate all metadata from the adapter that owns one exact
     * route. The result is detached from adapter-owned objects; catalog
     * membership remains advisory and does not control request routing.
     * @param provider - registered provider route to inspect.
     * @param model - exact model id passed to the adapter.
     * @param signal - optional cancellation for adapter-owned asynchronous lookup.
     * @returns exact model identity plus available context and reasoning metadata.
     */
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    private resolveModelInfoFor;
    /** Validate and detach one adapter-returned exact model result. */
    private normalizeModelInfo;
    /**
     * Validate a conversation call config against its exact model capability and
     * materialize adapter-configured defaults. Unsupported explicit efforts
     * reject before provider I/O; no clamping or aliasing is performed. This
     * standalone query does not bind a later dispatch; use {@link prepareCall}
     * when logging and streaming must share one adapter registration.
     * @param config - provider/model route and optional request controls.
     * @param signal - optional cancellation for adapter-owned capability lookup.
     * @returns a detached config only when a default must be materialized.
     */
    resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>;
    private resolveCallFor;
    /** Validate request controls against one already-bound exact model result. */
    private resolveCallWithInfo;
    /**
     * Resolve one call under its current adapter registration. The returned
     * one-shot handle keeps that registration across header logging and dispatch,
     * so HMR cannot combine one adapter's capability result with another adapter.
     * @param config - provider/model route and optional request controls.
     * @param signal - optional cancellation for adapter-owned capability lookup.
     * @returns a prepared config and its registration-bound stream entry point.
     */
    prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>;
    private registration;
    /** Remove replay state whose historical route is owned by another adapter. */
    private forAdapter;
    /**
     * Resolve the current execution-world read path of one durable file
     * reference through the mounted attachment and filesystem providers.
     */
    private fileReadPath;
    /**
     * Final adapter boundary. Adapter selection, dispatch, iterator construction,
     * and iteration failures become one terminal failure chunk. Middleware and
     * downstream consumer failures remain thrown plugin or consumer errors.
     */
    private adapterStream;
    /**
     * Stream one model call as raw chunks (token-level deltas). Replay state is
     * retained only when the same adapter instance owns its historical provider
     * and the target provider. Final adapter selection remains fixed through
     * asynchronous exact-model resolution and dispatch. Adapter selection,
     * dispatch, and iteration failures become terminal `error` or `aborted`
     * finish chunks; middleware, nested-call, cleanup, and consumer failures
     * remain thrown.
     * @param options - the full request; `options.provider` selects the adapter.
     * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
     */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private streamWithRegistration;
}
export default LlmRuntime;
//# sourceMappingURL=index.d.ts.map