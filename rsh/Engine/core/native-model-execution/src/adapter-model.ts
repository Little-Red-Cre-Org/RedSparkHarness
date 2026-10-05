/** Installation-owned lifetime for the two real native HTTP adapters. */
import type { GenerateOptions, LlmAdapter, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm/native'
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

  async resolveModel(provider: string, model: string, caller?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const signal = this.signal(caller)
    return this.run(signal, async () => {
      const resolved = await this.adapter.resolveModel(provider, model, signal)
      signal.throwIfAborted()
      return resolved
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = this.signal(options.signal)
    signal.throwIfAborted()
    return {
      [Symbol.asyncIterator]: () => {
        signal.throwIfAborted()
        const stream = this.adapter.stream({ ...options, signal })[Symbol.asyncIterator]()
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
