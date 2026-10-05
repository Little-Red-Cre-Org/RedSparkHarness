/** Native model execution and Session recording for a single Agent step. */
import { AssistantStreamAccumulator, BlockAssembler, createAssistantMessage,
  resolveCallConfigWithModel, callConfigEquals, type LlmCallConfig, type PreparedAdapterCall, type LlmResolvedModelInfo, type FinishReason, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { type Session, type SessionEvent } from '@deepseek-ai/dsh-session/native'

/** Streaming model selected by a native profile. */
export interface NativeModel {
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
}

/** Recorded assistant message and the model's terminal reason. */
export interface NativeModelStepResult {
  readonly message: Message
  readonly finish: FinishReason
}

/** Canonical native stream assembly and assistant-event recording. */
export class NativeModelExecution {
  private readonly prepared = new WeakMap<NativePreparedModelStep, (options: GenerateOptions) => AsyncIterable<StreamChunk>>()
  constructor(private readonly model: NativeModel) {}

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
    const handle: NativePreparedModelStep = Object.freeze({ config: deepFreeze(structuredClone(resolved)),
      ...info === undefined ? {} : { modelInfo: deepFreeze(structuredClone(info)) } })
    this.prepared.set(handle, captured === undefined ? this.model.stream.bind(this.model) : captured.stream.bind(captured))
    return handle
  }

  /**
   * Execute one model step and persist its completed assistant message.
   * On interruption or protocol failure, append the partial attempt for the
   * caller's Session close path to persist without inventing a response.
   * @param request - open Session step and its already persisted model inputs.
   * @returns the recorded assistant message and terminal reason.
   */
  async execute(request: NativeModelStepRequest): Promise<NativeModelStepResult> {
    const { session, turn, step, options, append, persist } = request
    const accumulator = new AssistantStreamAccumulator()
    const assembler = new BlockAssembler()
    let finished = false
    try {
      const handle = request.prepared
      const dispatch = handle === undefined ? this.model.stream.bind(this.model) : this.prepared.get(handle)
      if (dispatch === undefined) throw new Error('native-model-execution: step was prepared by a different executor')
      if (handle !== undefined && !callConfigEquals(handle.config, options)) {
        throw new Error('native-model-execution: dispatch controls differ from the prepared request')
      }
      options.signal?.throwIfAborted()
      for await (const chunk of dispatch(options)) {
        options.signal?.throwIfAborted()
        if (finished) throw new Error('native-model-execution: model emitted data after terminal finish')
        if (chunk.type === 'finish') finished = true
        assembler.push(accumulator.push({ time: Date.now(), chunk }).chunk)
        request.onChunk?.(chunk)
      }
      options.signal?.throwIfAborted()
      if (!finished) throw new Error('native-model-execution: model ended without terminal finish')
    } catch (error: unknown) {
      append(session.append('assistant/attempt', { turn, step, stream: [...accumulator.snapshot()] }))
      throw error
    }
    if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
      append(session.append('assistant/attempt', { turn, step, stream: [...accumulator.snapshot()] }))
      throw new Error(`native-model-execution: model ${assembler.finish.kind}: ${assembler.finish.failure.message}`)
    }
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
}

export { NativeAdapterModel } from './adapter-model.ts'
