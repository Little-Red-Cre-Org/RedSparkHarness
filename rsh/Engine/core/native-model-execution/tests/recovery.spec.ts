/** Failed model attempts are offered to installed recovery policies before the step fails. */
import { describe, expect, it } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { LlmAdapter, LlmError, resolveRetryPolicy, type GenerateOptions, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { NativeModelExecution, type NativeModel, type NativeModelRecoveryRequest } from '../src/index.ts'
import { NativeAdapterModel } from '../src/adapter-model.ts'

const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const failed = (code: string): StreamChunk[] => [
  { type: 'text-delta', index: 0, text: 'partial' },
  { type: 'finish', reason: { kind: 'error', failure: { message: `failed with ${code}`, code } } },
]

/** Script one attempt per stream call; an Error entry is thrown by the adapter iterator. */
function fixture(attempts: readonly (readonly StreamChunk[] | Error)[], policy?: ResolvedRetryPolicy) {
  const id = SessionId('native-model-recovery-test')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/test', isSeeded: false, delegationDepth: 0,
  })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const pending: SessionEvent[] = []
  const chunks: StreamChunk[] = []
  let calls = 0
  let persisted = 0
  const controller = new AbortController()
  const model: NativeModel = {
    ...policy === undefined ? {} : { retryPolicy: () => policy },
    async *stream() {
      const attempt = attempts[calls++]
      if (attempt === undefined) throw new Error('unexpected model call')
      if (attempt instanceof Error) throw attempt
      yield* attempt
    },
  }
  const execution = new NativeModelExecution(model)
  const options: GenerateOptions = {
    provider: 'mock', model: 'fixture', messages: [], tools: [], sessionId: id, signal: controller.signal,
  }
  const request = {
    session, turn: 1, step: 1, options,
    append: (event: SessionEvent) => { pending.push(event) },
    persist: async () => { persisted++ },
    onChunk: (chunk: StreamChunk) => { chunks.push(chunk) },
  }
  return { execution, request, pending, chunks, controller, calls: () => calls, persisted: () => persisted }
}

describe('native model recovery', () => {
  it('keeps the original failure without installed recovery', async () => {
    const state = fixture([failed('RATE_LIMIT')])
    await expect(state.execution.execute(state.request)).rejects.toThrow('native-model-execution: model error: failed with RATE_LIMIT')
    expect(state.pending.map(event => event.type)).toEqual(['assistant/attempt'])
  })

  it('retries a failed finish with a fresh stream and records each attempt', async () => {
    const state = fixture([failed('RATE_LIMIT'), text('recovered')])
    const seen: NativeModelRecoveryRequest[] = []
    state.execution.onRecovery((request) => { seen.push(request); return Promise.resolve({ kind: 'retry' }) })
    const result = await state.execution.execute(state.request)
    expect(result.message.content).toEqual([{ type: 'text', text: 'recovered' }])
    expect(state.calls()).toBe(2)
    expect(state.pending.map(event => event.type)).toEqual(['assistant/attempt', 'assistant/message'])
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ turn: 1, step: 1, provider: 'mock', failure: { code: 'RATE_LIMIT' } })
    // A model without a declared policy gets the LlmRuntime default.
    expect(seen[0]?.retryPolicy).toEqual(resolveRetryPolicy(undefined, 'default'))
    // Live observers see the failed attempt before the retried attempt.
    expect(state.chunks.filter(chunk => chunk.type === 'finish')).toHaveLength(2)
  })

  it('offers a thrown adapter failure as normalized facts and rethrows it when unrecovered', async () => {
    const thrown = new LlmError('busy', 'RATE_LIMIT', { providerRetryAfterMs: 5 })
    const state = fixture([thrown])
    const seen: NativeModelRecoveryRequest[] = []
    state.execution.onRecovery(async (request, next) => { seen.push(request); return next() })
    await expect(state.execution.execute(state.request)).rejects.toBe(thrown)
    expect(seen[0]?.failure).toMatchObject({ message: 'busy', code: 'RATE_LIMIT', providerRetryAfterMs: 5 })
    expect(state.pending.map(event => event.type)).toEqual(['assistant/attempt'])
  })

  it('retries a thrown adapter failure when a policy claims it', async () => {
    const state = fixture([new LlmError('reset', 'TRANSPORT'), text('after transport')])
    state.execution.onRecovery(() => Promise.resolve({ kind: 'retry' }))
    const result = await state.execution.execute(state.request)
    expect(result.message.content).toEqual([{ type: 'text', text: 'after transport' }])
    expect(state.pending.map(event => event.type)).toEqual(['assistant/attempt', 'assistant/message'])
  })

  it('keeps an explicit retry after handling a downstream recovery failure', async () => {
    const downstreamError = new Error('downstream recovery failed')
    const state = fixture([failed('SERVER_ERROR'), text('recovered')])
    state.execution.onRecovery(() => Promise.reject(downstreamError))
    state.execution.onRecovery(async (_request, next) => {
      await expect(next()).rejects.toBe(downstreamError)
      return { kind: 'retry' }
    })

    const result = await state.execution.execute(state.request)

    expect(result.message.content).toEqual([{ type: 'text', text: 'recovered' }])
    expect(state.calls()).toBe(2)
    expect(state.pending.map(event => event.type)).toEqual(['assistant/attempt', 'assistant/message'])
  })

  it('does not offer consumer failures to recovery', async () => {
    const state = fixture([text('observed')])
    let offered = false
    state.execution.onRecovery(() => { offered = true; return Promise.resolve({ kind: 'retry' }) })
    const failure = new Error('observer failed')
    await expect(state.execution.execute({ ...state.request, onChunk: () => { throw failure } })).rejects.toBe(failure)
    expect(offered).toBe(false)
  })

  it('runs later policies first, delegates at most once and removes policies exactly', async () => {
    const state = fixture([failed('SERVER_ERROR'), failed('SERVER_ERROR')])
    const order: string[] = []
    state.execution.onRecovery(async (_request, next) => { order.push('first'); return next() })
    const remove = state.execution.onRecovery(async (_request, next) => { order.push('second'); return next() })
    await expect(state.execution.execute(state.request)).rejects.toThrow('model error')
    expect(order).toEqual(['second', 'first'])
    remove()
    remove()
    state.execution.onRecovery(async (_request, next) => { await next(); return next() })
    await expect(state.execution.execute(state.request)).rejects.toThrow('delegated more than once')
  })

  it('stops after recovery when the request was cancelled', async () => {
    const state = fixture([failed('RATE_LIMIT'), text('never')])
    state.execution.onRecovery(() => { state.controller.abort(new Error('stopped')); return Promise.resolve({ kind: 'retry' }) })
    await expect(state.execution.execute(state.request)).rejects.toThrow('stopped')
    expect(state.calls()).toBe(1)
  })

  it('captures the prepared route retry policy', async () => {
    const policy = resolveRetryPolicy({ mode: 'normal', maxRetries: 2 }, 'fixture retryPolicy')
    const state = fixture([failed('RATE_LIMIT')], policy)
    const prepared = await state.execution.prepareStep({ provider: 'mock', model: 'fixture' })
    expect(prepared.retryPolicy).toEqual(policy)
    expect(Object.isFrozen(prepared.retryPolicy)).toBe(true)
    let seen: ResolvedRetryPolicy | undefined
    state.execution.onRecovery(async (request, next) => { seen = request.retryPolicy; return next() })
    await expect(state.execution.execute({ ...state.request, prepared })).rejects.toThrow('model error')
    expect(seen).toEqual(policy)
    const undeclared = fixture([failed('RATE_LIMIT')])
    expect((await undeclared.execution.prepareStep({ provider: 'mock', model: 'fixture' })).retryPolicy).toEqual(resolveRetryPolicy(undefined, 'default'))
  })

  it('forwards the selected adapter provider policy', () => {
    const policy = resolveRetryPolicy({ mode: 'always' }, 'fixture retryPolicy')
    class Adapter extends LlmAdapter {
      override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined { return provider === 'known' ? policy : undefined }
      async * stream(): AsyncIterable<StreamChunk> { throw new Error('not streamed') }
    }
    const lifetime = new AbortController()
    const model = new NativeAdapterModel(new Adapter(), lifetime.signal)
    expect(model.retryPolicy('known')).toBe(policy)
    expect(model.retryPolicy('other')).toBeUndefined()
    lifetime.abort()
    expect(() => model.retryPolicy('known')).toThrow()
  })
})
