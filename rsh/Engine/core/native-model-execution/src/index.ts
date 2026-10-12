/** Native model execution and Session recording for a single Agent step. */
import { AssistantStreamAccumulator, BlockAssembler, createAssistantMessage, normalizeLlmFailure,
  resolveCallConfigWithModel, resolveRetryPolicy, callConfigEquals, type LlmCallConfig, type LlmFailure, type LlmImageRequestPricing, type PreparedAdapterCall, type LlmResolvedModelInfo, type ReasoningEffortId, type ResolvedRetryPolicy, type FinishReason, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { type Session, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeResponsesGenerationCapture, NativeResponsesOperationCapture, NativeResponsesPreparedGeneration,
  NativeResponsesRoute, NativeResponsesTransport } from './responses-transport.ts'
export type { NativeResponsesGenerationCapture, NativeResponsesJsonValue, NativeResponsesRoute,
  NativeResponsesOperationCapture, NativeResponsesPreparedGeneration, NativeResponsesTransport,
  NativeResponsesTransportResponse } from './responses-transport.ts'

/** Streaming model selected by a native profile. */
export interface NativeModel {
  /** Read the selected adapter's declared image pricing without I/O.
   * @param provider - recorded provider route.
   * @param model - recorded model id.
   * @returns adapter-owned pricing when declared.
   */
  imageRequestPricing?(provider: string, model: string): LlmImageRequestPricing | undefined
  /** Capture exact-model metadata and dispatch from the same Provider generation.
   * @param provider - configured route. @param model - exact model identity.
   * @param signal - cancellation during preparation.
   * @returns captured metadata and dispatch for the selected generation.
   */
  prepareCall?(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>
  /**
   * Resolve the exact selected model's input capabilities before file-image admission.
   * @param provider - configured Provider route.
   * @param model - exact model id captured in the Session request header.
   * @param signal - caller cancellation.
   * @returns metadata from this selected Provider; omission refuses image-tool admission.
   */
  resolveModel?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
  /**
   * Read the retry policy captured with one provider route, or undefined when the route declares none.
   * @param provider - configured route whose policy was captured with its adapter.
   * @returns the provider-owned policy; the executor applies normal defaults when this is undefined.
   */
  retryPolicy?(provider: string): ResolvedRetryPolicy | undefined
  /**
   * Stream the selected model request through the shared LLM protocol.
   * @param options - model route, durable messages, tool schemas and cancellation.
   * @returns chunks ending with one terminal finish.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** One request whose visible inputs have already been appended to its Session. */
export interface NativeModelStepRequest {
  readonly session: Session
  readonly turn: number
  readonly step: number
  readonly options: GenerateOptions
  /** Rebuild the model options from the current Session after recovery replaces its visible surface. */
  readonly rebuildOptions: () => GenerateOptions
  /** Request controls and dispatch captured before their Session header is persisted. */
  readonly prepared?: NativePreparedModelStep
  readonly append: (event: SessionEvent) => void
  readonly persist: () => Promise<void>
  /** Observe each accepted stream chunk without owning another model dispatch. */
  readonly onChunk?: (chunk: StreamChunk) => void
}

/** Immutable controls captured before header logging and actual model dispatch. */
export interface NativePreparedModelStep {
  readonly config: Readonly<LlmCallConfig>
  readonly modelInfo?: LlmResolvedModelInfo
  /** Provider retry policy captured with the prepared route, or LlmRuntime's default when the route declares none. */
  readonly retryPolicy?: ResolvedRetryPolicy
}

/** Facts of one failed model attempt offered to installed recovery policies. */
export interface NativeModelRecoveryRequest {
  readonly session: Session
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly failure: LlmFailure
  /** Provider policy for this route, or LlmRuntime's default when the route declares none. */
  readonly retryPolicy: ResolvedRetryPolicy
  readonly signal: AbortSignal
  /** Append one durable event for the owning Session. */
  readonly append: (event: SessionEvent) => void
  /** Persist every event appended since the previous persist. */
  readonly persist: () => Promise<void>
}

/** Decision returned by a recovery policy after durable scheduling. */
export type NativeModelRecoveryAction = { readonly kind: 'retry' } | undefined

/**
 * Decide whether one failed model attempt is retried.
 * @param request - failed attempt facts and the owning Session writer.
 * @param next - delegate at most once to the remaining policies; returning without it claims the failure.
 * @returns a retry decision, or undefined to keep the failure.
 */
export type NativeModelRecoveryPolicy = (
  request: NativeModelRecoveryRequest, next: () => Promise<NativeModelRecoveryAction>,
) => Promise<NativeModelRecoveryAction>

/** Recorded assistant message and the model's terminal reason. */
export interface NativeModelStepResult {
  readonly message: Message
  readonly finish: FinishReason
}

/** Canonical native stream assembly and assistant-event recording. */
export class NativeModelExecution {
  private readonly prepared = new WeakMap<NativePreparedModelStep, {
    readonly dispatch: (options: GenerateOptions) => AsyncIterable<StreamChunk>
    readonly nativeResponses?: NativeResponsesGenerationCapture
  }>()
  private readonly recoveryPolicies: NativeModelRecoveryPolicy[] = []
  constructor(private readonly model: NativeModel) {}

  /**
   * Install one recovery policy consulted after a failed model attempt.
   * @param policy - waterfall delegate that calls next at most once.
   * @returns exact idempotent removal; later policies run first.
   */
  onRecovery(policy: NativeModelRecoveryPolicy): () => void {
    this.recoveryPolicies.unshift(policy)
    let removed = false
    return () => {
      if (removed) return
      removed = true
      const index = this.recoveryPolicies.indexOf(policy)
      if (index >= 0) this.recoveryPolicies.splice(index, 1)
    }
  }

  /** Capture exact dispatch and resolve explicit controls before they enter Session history.
   * @param config - selected provider, model and explicit request controls.
   * @param signal - preparation cancellation.
   * @returns frozen controls and the identity of the captured dispatch.
   */
  async prepareStep(config: Readonly<LlmCallConfig>, signal?: AbortSignal): Promise<NativePreparedModelStep> {
    signal?.throwIfAborted()
    const captured = await this.model.prepareCall?.(config.provider, config.model, signal)
    const info = captured?.model ?? await this.model.resolveModel?.(config.provider, config.model, signal)
    signal?.throwIfAborted()
    if (info !== undefined && (info.provider !== config.provider || info.id !== config.model)) {
      throw new Error('native-model-execution: prepared metadata belongs to a different requested route')
    }
    const controls: LlmCallConfig = { provider: config.provider, model: config.model,
      ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
      ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
      ...config.temperature === undefined ? {} : { temperature: config.temperature },
      ...config.stop === undefined ? {} : { stop: config.stop } }
    const resolved = info === undefined ? controls : resolveCallConfigWithModel(controls, info)
    const retryPolicy = this.retryPolicyFor(undefined, config.provider)
    signal?.throwIfAborted()
    const handle: NativePreparedModelStep = Object.freeze({ config: deepFreeze(structuredClone(resolved)),
      ...info === undefined ? {} : { modelInfo: deepFreeze(structuredClone(info)) },
      retryPolicy: deepFreeze(structuredClone(retryPolicy)) })
    this.prepared.set(handle, { dispatch: captured === undefined ? this.model.stream.bind(this.model) : captured.stream.bind(captured),
      ...captured?.nativeResponses === undefined ? {} : { nativeResponses: captured.nativeResponses } })
    return handle
  }

  /** Capture Responses forwarding only from this executor's exact prepared model generation.
   * @param handle - step handle returned by this executor.
   * @param route - Engine-selected external model route.
   * @param maxTokens - optional parent generation ceiling.
   * @param signal - external operation cancellation.
   * @param reasoningEffort - selected effort to validate against captured model metadata.
   * @returns a captured transport owned until its external operation closes it.
   */
  async captureResponses(handle: NativePreparedModelStep, route: NativeResponsesRoute, maxTokens: number | undefined,
    signal: AbortSignal, reasoningEffort?: ReasoningEffortId): Promise<NativeResponsesTransport> {
    const prepared = this.prepared.get(handle)
    if (prepared === undefined) throw new Error('native-model-execution: Responses capture requires this executor\'s prepared step')
    if (route.provider !== handle.config.provider || route.model !== handle.config.model) {
      throw new Error('native-model-execution: Responses route must match its prepared model generation')
    }
    if (handle.modelInfo !== undefined) {
      resolveCallConfigWithModel({ provider: route.provider, model: route.model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort } }, handle.modelInfo)
    }
    const capture = prepared.nativeResponses
    if (capture === undefined) throw new Error('native-model-execution: selected model generation has no captured Responses transport')
    signal.throwIfAborted()
    const transport = await capture.capture({ route, ...maxTokens === undefined ? {} : { maxTokens } }, signal)
    try {
      signal.throwIfAborted()
      if (transport.route.provider !== route.provider || transport.route.model !== route.model) {
        throw new Error('native-model-execution: captured Responses transport belongs to a different route')
      }
      if (maxTokens !== undefined && transport.outputTokenLimit !== 'supported') {
        throw new Error('native-model-execution: captured Responses transport cannot enforce the parent maxTokens ceiling')
      }
      return transport
    } catch (error: unknown) {
      try { await transport.close() }
      catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], 'native-model-execution: rejected Responses capture failed to close')
      }
      throw error
    }
  }

  /** Capture one external operation and retain its exact model generation for nested children.
   * @param parent - exact prepared step selected by this executor.
   * @param route - Engine-selected child route.
   * @param maxTokens - optional child output-token ceiling.
   * @param signal - parent and child operation cancellation.
   * @param reasoningEffort - explicitly selected child reasoning effort.
   * @returns an independent transport and a capability bound to the selected prepared generation.
   */
  async captureResponsesOperation(parent: NativePreparedModelStep, route: NativeResponsesRoute,
    maxTokens: number | undefined, signal: AbortSignal, reasoningEffort?: ReasoningEffortId): Promise<NativeResponsesOperationCapture> {
    if (!this.prepared.has(parent)) {
      throw new Error('native-model-execution: Responses capture requires this executor\'s prepared step')
    }
    const handle = route.provider === parent.config.provider && route.model === parent.config.model
      ? parent
      : await this.prepareStep({ provider: route.provider, model: route.model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
        ...maxTokens === undefined ? {} : { maxTokens } }, signal)
    const transport = await this.captureResponses(handle, route, maxTokens, signal, reasoningEffort)
    return { transport, generation: this.responsesGeneration(handle) }
  }

  private responsesGeneration(handle: NativePreparedModelStep): NativeResponsesPreparedGeneration {
    if (!this.prepared.has(handle)) throw new Error('native-model-execution: Responses generation requires this executor\'s prepared step')
    const route = Object.freeze({ provider: handle.config.provider, model: handle.config.model })
    return Object.freeze({ route, capture: (request: {
      readonly route: NativeResponsesRoute
      readonly maxTokens?: number
      readonly reasoningEffort?: ReasoningEffortId
    }, signal: AbortSignal) => this.captureResponsesOperation(handle,
      request.route, request.maxTokens, signal, request.reasoningEffort) })
  }

  /**
   * Execute one model step and persist its completed assistant message.
   * On interruption or protocol failure, append the partial attempt for the
   * caller's Session close path to persist without inventing a response.
   * @param request - open Session step and its already persisted model inputs.
   * @returns the recorded assistant message and terminal reason.
   */
  async execute(request: NativeModelStepRequest): Promise<NativeModelStepResult> {
    const { session, turn, step, append, persist } = request
    let options = request.options
    const handle = request.prepared
    const prepared = handle === undefined ? undefined : this.prepared.get(handle)
    const dispatch = handle === undefined ? this.model.stream.bind(this.model) : prepared?.dispatch
    if (dispatch === undefined) throw new Error('native-model-execution: step was prepared by a different executor')
    if (handle !== undefined && !callConfigEquals(handle.config, options)) {
      throw new Error('native-model-execution: dispatch controls differ from the prepared request')
    }
    // Each attempt assembles its own stream; a retry starts fresh, matching the Cordis loop.
    for (;;) {
      const accumulator = new AssistantStreamAccumulator()
      const assembler = new BlockAssembler()
      let finished = false
      let modelFailure: { readonly error: unknown } | undefined
      try {
        options.signal?.throwIfAborted()
        let stream: AsyncIterator<StreamChunk> | undefined
        try { stream = dispatch(options)[Symbol.asyncIterator]() }
        catch (error: unknown) { modelFailure = { error } }
        let open = stream !== undefined
        try {
          while (stream !== undefined) {
            let item: IteratorResult<StreamChunk>
            try { item = await stream.next() }
            catch (error: unknown) { open = false; modelFailure = { error }; break }
            if (item.done === true) { open = false; break }
            const chunk = item.value
            options.signal?.throwIfAborted()
            if (finished) throw new Error('native-model-execution: model emitted data after terminal finish')
            if (chunk.type === 'finish') finished = true
            assembler.push(accumulator.push({ time: Date.now(), chunk }).chunk)
            request.onChunk?.(chunk)
          }
        } finally {
          if (open) await stream?.return?.()
        }
        if (modelFailure === undefined) {
          options.signal?.throwIfAborted()
          if (!finished) throw new Error('native-model-execution: model ended without terminal finish')
        }
      } catch (error: unknown) {
        append(session.append('assistant/attempt', { turn, step, stream: [...accumulator.snapshot()] }))
        throw error
      }
      if (modelFailure !== undefined) {
        // An adapter throw is the native counterpart of LlmRuntime's terminal failure chunk: recovery sees
        // its normalized facts, and an unrecovered throw keeps its original error for the turn outcome.
        append(session.append('assistant/attempt', { turn, step, stream: [...accumulator.snapshot()] }))
        if (options.signal?.aborted === true) throw modelFailure.error
        const generation = session.surface.replaceGeneration
        const action = await this.recover({
          session, turn, step, provider: options.provider, failure: normalizeLlmFailure(modelFailure.error),
          retryPolicy: this.retryPolicyFor(handle, options.provider),
          signal: options.signal ?? new AbortController().signal, append, persist,
        })
        options.signal?.throwIfAborted()
        if (action?.kind === 'retry') {
          if (session.surface.replaceGeneration !== generation) {
            options = request.rebuildOptions()
            if (handle !== undefined && !callConfigEquals(handle.config, options)) {
              throw new Error('native-model-execution: refreshed dispatch controls differ from the prepared request')
            }
          }
          continue
        }
        throw modelFailure.error
      }
      if (assembler.finish.kind !== 'error' && assembler.finish.kind !== 'aborted') {
        const message = createAssistantMessage({ content: assembler.blocks(), source: {
          provider: options.provider, model: options.model,
        } })
        append(session.append('assistant/message', {
          turn, step, message, stream: [...accumulator.snapshot()],
          ...assembler.usage === undefined ? {} : { usage: assembler.usage },
        }, { surfaceOp: 'append' }))
        await persist()
        return { message, finish: assembler.finish }
      }
      const failure = assembler.finish.failure
      const kind = assembler.finish.kind
      append(session.append('assistant/attempt', { turn, step, stream: [...accumulator.snapshot()] }))
      if (options.signal?.aborted === true) throw new Error(`native-model-execution: model ${kind}: ${failure.message}`)
      const generation = session.surface.replaceGeneration
      const action = await this.recover({
        session, turn, step, provider: options.provider, failure,
        retryPolicy: this.retryPolicyFor(handle, options.provider),
        signal: options.signal ?? new AbortController().signal, append, persist,
      })
      options.signal?.throwIfAborted()
      if (action?.kind !== 'retry') {
        throw new Error(`native-model-execution: model ${kind}: ${failure.message}`)
      }
      if (session.surface.replaceGeneration !== generation) {
        options = request.rebuildOptions()
        if (handle !== undefined && !callConfigEquals(handle.config, options)) {
          throw new Error('native-model-execution: refreshed dispatch controls differ from the prepared request')
        }
      }
    }
  }

  /** The prepared policy, else the model's, else the same default LlmRuntime applies to an adapter without one. */
  private retryPolicyFor(handle: NativePreparedModelStep | undefined, provider: string): ResolvedRetryPolicy {
    return handle?.retryPolicy ?? this.model.retryPolicy?.(provider) ?? resolveRetryPolicy(undefined, 'native-model-execution: model retryPolicy')
  }

  private async recover(request: NativeModelRecoveryRequest): Promise<NativeModelRecoveryAction> {
    const policies = [...this.recoveryPolicies]
    let delegationViolation: Error | undefined
    const delegate = async (index: number): Promise<NativeModelRecoveryAction> => {
      request.signal.throwIfAborted()
      const policy = policies[index]
      if (policy === undefined) return undefined
      let delegated = false
      let downstream: Promise<NativeModelRecoveryAction> | undefined
      let primary: { error: unknown } | undefined
      let selected: NativeModelRecoveryAction
      try {
        selected = await policy(request, () => {
          if (delegated) {
            const error = new Error('native-model-execution: recovery policy delegated more than once')
            delegationViolation ??= error
            throw error
          }
          delegated = true
          downstream = delegate(index + 1)
          return downstream
        })
      } catch (error: unknown) { primary = { error } }
      if (downstream !== undefined) {
        try { await downstream }
        catch (error: unknown) {
          if (primary === undefined) {
            if (selected?.kind !== 'retry') primary = { error }
          } else if (primary.error !== error) {
            primary = { error: new AggregateError([primary.error, error], 'recovery policies failed') }
          }
        }
      }
      if (primary !== undefined) throw primary.error
      return selected
    }
    const action = await delegate(0)
    if (delegationViolation !== undefined) throw delegationViolation
    return action
  }
}

export { NativeAdapterModel } from './adapter-model.ts'
