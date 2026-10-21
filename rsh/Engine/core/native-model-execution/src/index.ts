/** Native model execution and Session recording for a single Agent step. */
import { AssistantStreamAccumulator, BlockAssembler, createAssistantMessage,
  type FinishReason, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { type Session, type SessionEvent } from '@deepseek-ai/dsh-session/native'

/** Streaming model selected by a native profile. */
export interface NativeModel {
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
  readonly append: (event: SessionEvent) => void
  readonly persist: () => Promise<void>
}

/** Recorded assistant message and the model's terminal reason. */
export interface NativeModelStepResult {
  readonly message: Message
  readonly finish: FinishReason
}

/** Canonical native stream assembly and assistant-event recording. */
export class NativeModelExecution {
  constructor(private readonly model: NativeModel) {}

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
      for await (const chunk of this.model.stream(options)) {
        options.signal?.throwIfAborted()
        if (finished) throw new Error('native-model-execution: model emitted data after terminal finish')
        if (chunk.type === 'finish') finished = true
        assembler.push(accumulator.push({ time: Date.now(), chunk }).chunk)
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
