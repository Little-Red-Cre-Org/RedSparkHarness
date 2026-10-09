/**
 * Generic pi-ai-backed implementation of the Harness LLM seam.
 *
 * Each resolution produces one **immutable** snapshot — the profiles plus a
 * `Models` collection holding the `Provider` each route built — and an
 * operation captures a whole snapshot before its first `await`. A
 * configuration change builds a *new* collection rather than mutating the one
 * in use, because `Models.streamSimple()` is lazy: it resolves the provider
 * when the stream is first consumed, which is after the credential await, so a
 * mutated collection would let a request that started under one configuration
 * finish under another — or fail with a provider that no longer exists. This is
 * what makes the seam's per-step call freeze (`llm.prepareCall()`) hold all the
 * way down: switching models mid-reply takes effect on the next step, never
 * inside the one in flight.
 *
 * A route naming a credential reference still resolves it through the harness
 * seam and passes it as the request's `apiKey` option, which pi-ai treats as
 * the highest-priority auth override — that is what keeps the fail-loud
 * reference semantics. Everything that override does not cover reaches pi-ai
 * through the collection's own auth: the credential store holds the records a
 * login wrote and a refresh rotates, and the auth context answers the ambient
 * questions a provider asks while resolving. Both are stable across snapshots,
 * so a configuration change rebuilds the collection without forgetting who is
 * signed in.
 *
 * @module dsh-llm-pi-ai/adapter
 */

import { createAssistantMessageEventStream, createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type {
  Api,
  AssistantMessageEventStream,
  AuthResult,
  AuthContext,
  CredentialStore,
  Model,
  Models,
  ModelThinkingLevel,
  MutableModels,
  Provider,
  RefreshModelsContext,
  SimpleStreamOptions,
  ThinkingLevel,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm/native'
import type {
  GenerateOptions,
  ImageAttachmentAccess,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ReasoningEffortId as ReasoningEffortIdType,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm/native'
import type { AttachmentOperations, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { catalogProvider } from './catalog.ts'
import { toPiContext } from './context.ts'
import { fetchCodexModels } from './discovery.ts'
import { createSiwcOAuth, isSiwcCredential } from './siwc.ts'
import { toStreamChunks } from './stream.ts'

/** One resolution's frozen view: the profiles and the collection built from them. */
interface PiAiSnapshot {
  /** The resolved profiles this collection was built from, used as its identity. */
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /** Providers for exactly those profiles; never mutated once published. */
  models: Models
  /** In-flight Codex refreshes keyed by provider; tied to this snapshot's lifetime. */
  refreshes: Map<string, Promise<void>>
  /** Cancels work owned by this snapshot when it is invalidated or disposed. */
  controller: AbortController
}

/** Constructor options for {@link PiAiAdapter}: the two resolution hooks the plugin owns. */
export interface PiAiAdapterOptions {
  /** Current validated profiles by provider route; called once per operation. */
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /**
   * Resolve the credential for one already-resolved profile; called once per
   * stream call and frozen for that call. `undefined` defers to the route's own
   * pi-ai auth, which for an installed catalog route is its provider-native
   * ambient discovery; the plugin allows that only for a profile naming no
   * credential at all, because a named reference that misses throws `LlmError`
   * `MISSING_CREDENTIAL` rather than falling back.
   */
  resolveApiKey: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<string | undefined>
  /**
   * How every collection this adapter builds resolves auth the request-level
   * `apiKey` override does not cover. Required rather than optional: a
   * collection built without them gets pi-ai's in-memory default store, which
   * is empty at every boot and discarded on every configuration change, so a
   * route whose only method is a login would report itself unconfigured on
   * every request no matter how often the human signed in.
   */
  auth: PiAiAuthInjection
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentOperations | undefined
  /** Bridge one attachment reference into the current model-tool execution world. */
  resolveImageAccess?: (attachments: AttachmentOperations, ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined
  /**
   * Observe one assistant history message degrading to provider-neutral
   * conversion because its stored replay state is unusable by this build.
   */
  onReplayDegrade?: (detail: { provider: string; model: string; reason: string }) => void
}

/** The two auth injectables a pi-ai collection is built with. */
export interface PiAiAuthInjection {
  /** Durable storage for credentials pi-ai itself writes: logins, and the refreshes it runs under its own lock. */
  credentials: CredentialStore
  /** Ambient lookups a provider performs while resolving its own auth. */
  authContext: AuthContext
}

/** Copy profile stream knobs into pi-ai's common option vocabulary. */
function profileOptions(
  profile: ResolvedPiAiProviderProfile,
  reasoning: ModelThinkingLevel | undefined,
  apiKey: string | undefined,
): SimpleStreamOptions {
  const enabledReasoning: ThinkingLevel | undefined = reasoning === 'off' ? undefined : reasoning
  return {
    ...apiKey === undefined ? {} : { apiKey },
    ...enabledReasoning === undefined ? {} : { reasoning: enabledReasoning },
    ...profile.thinkingBudgets === undefined ? {} : { thinkingBudgets: profile.thinkingBudgets },
    ...profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention },
    ...profile.transport === undefined ? {} : { transport: profile.transport },
    ...profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs },
    ...profile.websocketConnectTimeoutMs === undefined ? {} : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs },
    // The agent recovery layer owns visible attempts; one adapter call is one SDK attempt.
    maxRetries: 0,
  }
}

/**
 * The profile default this exact model can actually take, for DESCRIBING it.
 * A configured level the model does not support yields none rather than
 * throwing: `resolveModel` builds the model catalog, and a catalog that fails
 * takes its whole provider out of every picker — so one mis-set profile field
 * would hide every model on the route, including the ones that support the
 * level. The request path still refuses, which is where a bad configuration
 * belongs: describing what a model can do must not fail because a deployment
 * asked it for something it cannot.
 * @param model - the resolved model descriptor.
 * @param effort - the profile's configured level, if any.
 * @returns the level when this model supports it, otherwise undefined.
 */
function describableReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  return getSupportedThinkingLevels(model).some(level => level === effort)
    ? effort as ModelThinkingLevel
    : undefined
}

/** Validate an explicit Harness/profile effort without invoking pi-ai's clamp. */
function resolveReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  const supported = getSupportedThinkingLevels(model)
  if (supported.some(level => level === effort)) return effort as ModelThinkingLevel
  throw new LlmError(
    `pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Selectable reasoning efforts for one model, or nothing at all.
 *
 * A model that carries no reasoning metadata — every hand-declared one, and
 * every catalog model pi-ai marks as non-reasoning — is reported by pi-ai as
 * supporting the single level `off`. Passing that through would offer a control
 * that cannot do what it says: `off` is translated to *omitting* the reasoning
 * option, which for such a model is byte-for-byte the same request as naming no
 * effort — so a provider whose own default is to think would keep thinking with
 * `off` selected. Omitting `reasoning` entirely is the seam's way of saying the
 * capability is unavailable, which leaves the surface offering only the
 * provider's default.
 * @param model - the resolved model descriptor.
 * @param defaultLevel - the profile's configured effort, already validated.
 * @returns the `reasoning` field, or an empty object when none can be offered.
 */
function reasoningInfo(
  model: Model<Api>,
  defaultLevel: ModelThinkingLevel | undefined,
): Pick<LlmResolvedModelInfo, 'reasoning'> | Record<string, never> {
  if (!model.reasoning) return {}
  const levels = getSupportedThinkingLevels(model)
  return {
    reasoning: {
      efforts: levels.map(level => ({
        id: ReasoningEffortId(level),
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
      ...defaultLevel === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultLevel) },
    },
  }
}

/** Merge deployment headers while removing case-insensitive attribution collisions. */
function requestHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  }
}

const CODEX_SUBSCRIPTION_ROUTE = 'openai-codex'
const OPENAI_RESPONSES_BASE_URL = 'https://api.openai.com/v1'
const SIWC_TOOL_NAMESPACE = 'harness'

/** SIWC rejects system-role items and top-level function tools. */
function siwcResponsesPayload(payload: unknown): unknown {
  const body = payload as {
    input?: { role?: string; type?: string; namespace?: string }[]
    tools?: unknown
  }
  if (body.input !== undefined) {
    for (const item of body.input) {
      if (item.role === 'system') item.role = 'developer'
      if (item.type === 'function_call' || item.type === 'custom_tool_call') item.namespace = SIWC_TOOL_NAMESPACE
    }
  }
  if (body.tools !== undefined) {
    body.tools = [{
      type: 'namespace',
      name: SIWC_TOOL_NAMESPACE,
      description: 'Tools the harness exposes to the model.',
      tools: body.tools,
    }]
  }
  return body
}

/** pi-ai requires numeric rates; the Harness does not publish these internal placeholders. */
const NO_MODEL_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** pi-ai recognizes Sign in with ChatGPT on its OpenAI provider identity. */
function asChatGptPlanModel(model: Model<Api>): Model<Api> {
  return { ...model, provider: 'openai', api: 'openai-responses', baseUrl: OPENAI_RESPONSES_BASE_URL }
}

/**
 * The Harness routes this account as `openai-codex` while pi-ai streams it as
 * `openai`. History goes out under the transport identity so pi-ai replays it as
 * same-model output, and results come back under the route identity so the
 * stored replay state matches its assistant source.
 */
function asOpenAiContext(context: TranscriptContext): TranscriptContext {
  return {
    ...context,
    messages: context.messages.map(message => message.role === 'assistant' && message.provider === CODEX_SUBSCRIPTION_ROUTE
      ? { ...message, provider: 'openai' }
      : message),
  }
}

function asCodexRouteEvents(events: AssistantMessageEventStream): AssistantMessageEventStream {
  const relabeled = createAssistantMessageEventStream()
  void (async () => {
    for await (const event of events) {
      if ('partial' in event) event.partial.provider = CODEX_SUBSCRIPTION_ROUTE
      if ('message' in event) event.message.provider = CODEX_SUBSCRIPTION_ROUTE
      if ('error' in event) event.error.provider = CODEX_SUBSCRIPTION_ROUTE
      relabeled.push(event)
    }
    relabeled.end()
  })()
  return relabeled
}

/** Account-scoped SIWC catalog over the public OpenAI Responses API. */
function codexSubscriptionProvider(base: Provider, credentials: CredentialStore): Provider {
  const openai = catalogProvider('openai')
  if (openai === undefined) throw new Error('llm-pi-ai: installed pi-ai catalog has no OpenAI Responses provider')

  const oauth = createSiwcOAuth(credentials)
  let currentModels: readonly Model<Api>[] = []

  return {
    ...base,
    auth: { ...base.auth, oauth },
    baseUrl: OPENAI_RESPONSES_BASE_URL,
    getModels: () => currentModels,
    refreshModels: async (context: RefreshModelsContext): Promise<void> => {
      if (!context.allowNetwork) return
      if (!isSiwcCredential(context.credential)
        || !context.credential.scopes.includes('chatgpt.tokens.use.direct')) {
        throw new Error('OpenAI Codex model refresh requires the selected ChatGPT account OAuth sign-in')
      }
      const entries = await fetchCodexModels(context.credential.access, context.signal)
      const models = entries
        .map(({ id, name }): Model<Api> => ({
          id,
          name,
          api: 'openai-responses',
          provider: CODEX_SUBSCRIPTION_ROUTE,
          baseUrl: OPENAI_RESPONSES_BASE_URL,
          // The public catalog documents slugs and display names, not model capabilities.
          input: ['text'],
          cost: NO_MODEL_COST,
          reasoning: false,
          contextWindow: 0,
          maxTokens: 0,
        }))
      await context.publish({ update: () => { currentModels = models } })
    },
    stream: (model, context, options) =>
      asCodexRouteEvents(openai.stream(asChatGptPlanModel(model), asOpenAiContext(context), options)),
    streamSimple: (model, context, options) =>
      asCodexRouteEvents(openai.streamSimple(asChatGptPlanModel(model), asOpenAiContext(context), options)),
  }
}

/**
 * pi-ai-backed multi-provider adapter. Each operation reads the current
 * profiles, so a configuration change reaches the next request without a
 * restart; model descriptors come from the collection those profiles built.
 */
export class PiAiAdapter extends LlmAdapter {
  private snapshot: PiAiSnapshot | undefined

  constructor(private readonly config: PiAiAdapterOptions) {
    super()
  }

  /** Abort snapshot work and discard the provider collection after credentials change. */
  invalidate(): void {
    this.snapshot?.controller.abort()
    this.snapshot = undefined
  }

  /** Cancel work owned by the current provider collection and discard it. */
  dispose(): void {
    this.invalidate()
  }

  /**
   * The snapshot for the current profiles. Resolution memoizes its result, so
   * an unchanged configuration is recognized by identity; a changed one gets a
   * brand-new collection, leaving any snapshot an operation already captured
   * untouched for as long as that operation holds it.
   */
  private current(): PiAiSnapshot {
    const profiles = this.config.profiles()
    if (this.snapshot?.profiles === profiles) return this.snapshot
    const models: MutableModels = createModels(this.config.auth)
    for (const profile of profiles.values()) {
      if (profile.piProvider !== undefined) {
        models.setProvider(profile.provider === CODEX_SUBSCRIPTION_ROUTE
          ? codexSubscriptionProvider(profile.piProvider, this.config.auth.credentials)
          : profile.piProvider)
      }
    }
    this.snapshot = { profiles, models, refreshes: new Map(), controller: new AbortController() }
    return this.snapshot
  }

  /** The profile for one route within one snapshot, or the not-owned failure. */
  private profileOf(snapshot: PiAiSnapshot, provider: string): ResolvedPiAiProviderProfile {
    const profile = snapshot.profiles.get(provider)
    if (profile === undefined) {
      throw new LlmError(`pi-ai adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    }
    return profile
  }

  /** The configured descriptor for one exact route/model pair within one snapshot. */
  private modelOf(snapshot: PiAiSnapshot, provider: string, model: string): Model<Api> {
    const profile = this.profileOf(snapshot, provider)
    const failure = profile.modelErrors.get(model)
      ?? (profile.piProvider === undefined ? profile.catalogError : undefined)
    if (failure !== undefined) throw new LlmError(failure, 'INVALID_CONFIG')
    const resolved = snapshot.models.getModel(provider, model)
    if (resolved === undefined) {
      throw new LlmError(`pi-ai provider "${provider}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
    }
    return resolved
  }

  /** Load the public account catalog through this snapshot's saved OAuth authority. */
  private async refreshCodexCatalog(
    snapshot: PiAiSnapshot,
    provider: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const auth = await snapshot.models.getAuth(provider, signal === undefined ? undefined : { signal })
    signal?.throwIfAborted()
    if (auth?.auth.apiKey === undefined || auth.auth.apiKey.length === 0) {
      throw new LlmError('OpenAI Codex model discovery needs an active Sign in with ChatGPT account', 'MISSING_CREDENTIAL')
    }
    // A later refresh aborts the earlier one inside pi-ai, so one snapshot shares one flight.
    // The shared flight uses the snapshot lifetime signal; discovery also times the /models request out itself.
    let refresh = snapshot.refreshes.get(provider)
    if (refresh === undefined) {
      refresh = snapshot.models.refresh({ providers: [provider], force: true, signal: snapshot.controller.signal }).then((refreshed) => {
        const failure = refreshed.errors.get(provider)
        if (failure !== undefined) throw failure
      })
      snapshot.refreshes.set(provider, refresh)
      const clear = (): void => { snapshot.refreshes.delete(provider) }
      void refresh.then(clear, clear)
    }
    if (signal === undefined) return refresh
    signal.throwIfAborted()
    const shared = refresh
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => { reject(signal.reason as Error) }
      signal.addEventListener('abort', onAbort, { once: true })
      shared.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
    })
  }

  /** A request can arrive before any model-directory surface has fetched the account catalog. */
  private async ensureCodexCatalog(
    snapshot: PiAiSnapshot,
    provider: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (provider === CODEX_SUBSCRIPTION_ROUTE && snapshot.models.getModels(provider).length === 0) {
      await this.refreshCodexCatalog(snapshot, provider, signal)
    }
  }

  override providerInfo(provider: string): LlmProviderInfo {
    // The configured name, not the route key: `displayName` exists so a
    // deployment can label a route, and a label only the configuration surface
    // reads would leave every selector showing the raw key.
    return { id: provider, name: this.current().profiles.get(provider)?.displayName ?? provider }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.current().profiles.get(provider)?.retryPolicy
  }

  override async listModels(provider: string, signal?: AbortSignal): Promise<readonly LlmModelInfo[]> {
    const snapshot = this.current()
    this.profileOf(snapshot, provider)
    if (provider === CODEX_SUBSCRIPTION_ROUTE) {
      await this.refreshCodexCatalog(snapshot, provider, signal)
    }
    return snapshot.models.getModels(provider).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: [...model.input],
    }))
  }

  /**
   * Resolve auth through the current pi-ai collection, including its OAuth refresh lock.
   * @param provider - the configured pi-ai route whose authentication is read.
   * @param signal - optional signal forwarded to provider auth resolution.
   * @returns the provider auth result, or undefined when the collection has none.
   */
  getProviderAuth(provider: string, signal?: AbortSignal): Promise<AuthResult | undefined> {
    const snapshot = this.current()
    this.profileOf(snapshot, provider)
    return snapshot.models.getAuth(provider, signal === undefined ? undefined : { signal })
  }

  override resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(async () => {
      const snapshot = this.current()
      this.profileOf(snapshot, provider)
      await this.ensureCodexCatalog(snapshot, provider, signal)
      return this.modelInfo(snapshot, provider, model)
    })
  }

  private modelInfo(snapshot: PiAiSnapshot, provider: string, model: string): LlmResolvedModelInfo {
    const profile = this.profileOf(snapshot, provider)
    const resolvedModel = this.modelOf(snapshot, provider, model)
    const defaultLevel = describableReasoningLevel(resolvedModel, profile.reasoning)
    // Only a cap the deployment configured is a request default; the
    // catalog's `maxTokens` sizes the model and stops there.
    const configuredMaxTokens = profile.configuredMaxTokens.get(model)
    if (provider === CODEX_SUBSCRIPTION_ROUTE && configuredMaxTokens !== undefined) {
      throw new LlmError(
        'OpenAI Codex Sign in with ChatGPT does not support a configured output-token cap',
        'UNSUPPORTED_OPTION',
      )
    }
    return {
      provider,
      id: model,
      name: resolvedModel.name,
      inputModalities: [...resolvedModel.input],
      ...resolvedModel.contextWindow > 0 ? { context: { contextWindow: resolvedModel.contextWindow } } : {},
      ...configuredMaxTokens === undefined ? {} : { defaultMaxTokens: configuredMaxTokens },
      ...reasoningInfo(resolvedModel, defaultLevel),
    }
  }

  override prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const snapshot = this.current()
    return Promise.resolve().then(async () => {
      this.profileOf(snapshot, provider)
      await this.ensureCodexCatalog(snapshot, provider, signal)
      return {
        model: this.modelInfo(snapshot, provider, model),
        stream: options => this.streamWithSnapshot(options, snapshot),
      }
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithSnapshot(options, this.current())
  }

  private async * streamWithSnapshot(
    options: GenerateOptions,
    snapshot: PiAiSnapshot,
  ): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('llm-pi-ai does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    // One capture per stream call, taken before any await: the profile, the
    // model descriptor, and the collection all come from the same immutable
    // snapshot, and the credential freezes with them. A configuration change
    // mid-request builds a separate snapshot, so this request finishes under
    // the one it started with and the next call picks up the new one.
    const profile = this.profileOf(snapshot, options.provider)
    if (options.provider === CODEX_SUBSCRIPTION_ROUTE) {
      const unsupported = [
        options.maxTokens === undefined ? undefined : 'maxTokens',
        options.temperature === undefined ? undefined : 'temperature',
        profile.configuredMaxTokens.has(options.model) ? 'configuredMaxTokens' : undefined,
      ].filter((name): name is string => name !== undefined)
      if (unsupported.length > 0) {
        throw new LlmError(
          `OpenAI Codex Sign in with ChatGPT does not support ${unsupported.join(', ')} on the public Responses route`,
          'UNSUPPORTED_OPTION',
        )
      }
    }
    await this.ensureCodexCatalog(snapshot, options.provider, options.signal)
    const model = this.modelOf(snapshot, options.provider, options.model)
    const reasoning = resolveReasoningLevel(
      model,
      options.reasoningEffort ?? profile.reasoning,
    )
    const apiKey = options.provider === CODEX_SUBSCRIPTION_ROUTE
      ? undefined
      : await this.config.resolveApiKey(options.provider, profile)

    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    const streamIdleTimeoutMs = profile.streamIdleTimeoutMs
    using watchdog = idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')

    try {
      const containsImage = options.messages.some(message => contentHasImage(message.content))
      if (containsImage && !model.input.includes('image')) {
        throw new LlmError(`pi-ai model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
      }
      const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
      if (containsImage && attachments === undefined) {
        throw new LlmError('pi-ai image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const onReplayDegrade = (reason: string): void => {
        this.config.onReplayDegrade?.({ provider: options.provider, model: options.model, reason })
      }
      const context = attachments === undefined
        ? toPiContext(options, undefined, onReplayDegrade)
        : await toPiContext({ ...options, signal: watchdog.signal }, {
          attachments,
          resolveImageAccess: ref => this.config.resolveImageAccess?.(attachments, ref),
          maxRequestImageBytes: profile.maxRequestImageBytes,
          requestImagePolicy: {
            maxPixels: profile.requestImagePixelBudget,
            maxBytes: profile.requestImageMaxBytes,
          },
        }, onReplayDegrade)
      const events = options.provider === CODEX_SUBSCRIPTION_ROUTE
        ? snapshot.models.stream(model as Model<'openai-responses'>, context, {
          ...apiKey === undefined ? {} : { apiKey },
          ...reasoning === undefined || reasoning === 'off' ? {} : { reasoningEffort: reasoning },
          ...profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs },
          transport: 'sse',
          ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
          maxRetries: 0,
          signal: watchdog.signal,
          onPayload: siwcResponsesPayload,
          // Profile headers are deployment-owned; Harness attribution names are Harness-owned and win collisions.
          headers: requestHeaders(profile.headers),
        })
        : snapshot.models.streamSimple(model, context, {
          ...profileOptions(profile, reasoning, apiKey),
          ...options.temperature === undefined ? {} : { temperature: options.temperature },
          ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
          ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
          signal: watchdog.signal,
          // Profile headers are deployment-owned; Harness attribution names are Harness-owned and win collisions.
          headers: requestHeaders(profile.headers),
        })
      const iterator = toStreamChunks(
        events,
        model.contextWindow > 0 ? model.contextWindow : undefined,
        options.signal,
        model.id,
      )[Symbol.asyncIterator]()
      let exhausted = false
      try {
        while (true) {
          const result = await watchdog.next(iterator)
          const timeout = timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')
          if (timeout !== undefined) throw timeout
          if (result.done) {
            exhausted = true
            return
          }
          yield result.value
        }
      } finally {
        if (!exhausted) {
          consumer.abort('pi-ai stream consumer stopped')
          try {
            await iterator.return(undefined)
          } catch (_abortedSdkTeardown) {
            // The stable signal already owns SDK termination; return-time abort cannot add an outcome.
          }
        }
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
        throw new LlmError(`pi-ai stream idle timeout after ${streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('pi-ai request aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    } finally {
      consumer.abort('pi-ai stream consumer stopped')
    }
  }
}
