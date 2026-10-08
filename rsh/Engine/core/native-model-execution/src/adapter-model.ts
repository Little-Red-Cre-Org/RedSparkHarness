/** Installation-owned lifetime for the two real native HTTP adapters. */
import type { GenerateOptions, LlmAdapter, LlmImageRequestPricing, LlmResolvedModelInfo, PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm/native'
import type { NativeModel } from './index.ts'

/** Forward the selected adapter and drain accepted operations and stream cleanup during removal. */
export class NativeAdapterModel implements NativeModel {
  private readonly shutdown = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly streams = new Map<AsyncIterator<StreamChunk>, Promise<IteratorResult<StreamChunk>> | undefined>()
  private readonly cleanupFailures: unknown[] = []
  private closing: Promise<void> | undefined

  /**
   * @param adapter - actual Provider adapter.
   * @param lifetime - installation cancellation.
   */
  constructor(private readonly adapter: LlmAdapter, private readonly lifetime: AbortSignal) {}

  /** @inheritdoc */
  retryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    this.signal().throwIfAborted()
    return this.adapter.providerRetryPolicy(provider)
  }

  /** @inheritdoc */
  imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined {
    this.signal().throwIfAborted()
    return this.adapter.imageRequestPricing(provider, model)
  }

  private signal(caller?: AbortSignal): AbortSignal {
    return AbortSignal.any([this.lifetime, this.shutdown.signal, ...caller === undefined ? [] : [caller]])
  }

  private run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const work = operation()
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => {
      /* The caller observes operation failure; close waits for completion without reclassifying it as cleanup. */
    })
    return work
  }

  private closeStream(stream: AsyncIterator<StreamChunk>): Promise<IteratorResult<StreamChunk>> {
    const existing = this.streams.get(stream)
    if (existing !== undefined) return existing
    const work = Promise.resolve().then<IteratorResult<StreamChunk>>(() => stream.return?.() ?? { done: true, value: undefined })
    this.streams.set(stream, work)
    void work.then(
      () => { this.streams.delete(stream) },
      (error: unknown) => { this.cleanupFailures.push(error); this.streams.delete(stream) },
    )
    return work
  }

  /**
   * Resolve metadata through the selected adapter with composed cancellation.
   * @param provider - selected Provider route.
   * @param model - model identity within that route.
   * @param caller - optional request cancellation.
   * @returns the adapter's resolved model metadata.
   */
  async resolveModel(provider: string, model: string, caller?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const signal = this.signal(caller)
    return this.run(signal, async () => {
      const resolved = await this.adapter.resolveModel(provider, model, signal)
      signal.throwIfAborted()
      return resolved
    })
  }

  /** Capture the selected adapter generation under the Provider's operation ownership.
   * @param provider - configured route. @param model - exact model identity.
   * @param caller - optional request cancellation.
   * @returns metadata and a dispatcher retained by this Provider's stream cleanup.
   */
  async prepareCall(provider: string, model: string, caller?: AbortSignal): Promise<PreparedAdapterCall> {
    const signal = this.signal(caller)
    return this.run(signal, async () => {
      const captured = await this.adapter.prepareCall(provider, model, signal)
      signal.throwIfAborted()
      return { model: captured.model, stream: options => this.streamWith(options, captured.stream.bind(captured)) }
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWith(options, this.adapter.stream.bind(this.adapter))
  }

  private streamWith(options: GenerateOptions,
    dispatch: (options: GenerateOptions) => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const signal = this.signal(options.signal)
    signal.throwIfAborted()
    return {
      [Symbol.asyncIterator]: () => {
        signal.throwIfAborted()
        const stream = dispatch({ ...options, signal })[Symbol.asyncIterator]()
        this.streams.set(stream, undefined)
        return {
          next: () => this.run(signal, async () => {
            try {
              const result = await stream.next()
              signal.throwIfAborted()
              if (result.done) this.streams.delete(stream)
              return result
            } catch (error) {
              try { await this.closeStream(stream) }
              catch { /* close reports the recorded cleanup failure; this caller retains its request error. */ }
              throw error
            }
          }),
          return: () => this.closeStream(stream),
        }
      },
    }
  }

  /**
   * Cancel admission and close accepted iterators, including streams paused by their consumers.
   * @returns shared quiescence completion, reporting iterator cleanup failures after every operation settles.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.shutdown.abort(new Error('native-model-execution: adapter Provider removed'))
    const work = [...this.pending]
    const cleanup = [...this.streams.keys()].map(stream => this.closeStream(stream))
    this.closing = Promise.allSettled([...work, ...cleanup]).then(() => {
      const failures = this.cleanupFailures
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'native-model-execution: stream cleanup failed')
    })
    return this.closing
  }
}
