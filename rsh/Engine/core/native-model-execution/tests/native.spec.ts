/** Stream settlement records a completed assistant or a partial attempt. */
import { expect, it } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { NativeModelExecution } from '../src/index.ts'
import { NativeAdapterModel } from '../src/adapter-model.ts'
import { LlmAdapter } from '@deepseek-ai/dsh-llm/native'

function fixture(chunks: readonly StreamChunk[]) {
  const id = SessionId('native-model-execution-test')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/test', isSeeded: false, delegationDepth: 0,
  })
  const pending: SessionEvent[] = []
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  let persisted = 0
  const options: GenerateOptions = {
    provider: 'mock', model: 'fixture', messages: [], tools: [], sessionId: id, signal: new AbortController().signal,
  }
  const execution = new NativeModelExecution({ async *stream() { yield* chunks } })
  const request = { session, turn: 1, step: 1, options, append: (event: SessionEvent) => { pending.push(event) },
    persist: async () => { persisted++ } }
  return { execution, request, pending, persisted: () => persisted }
}

it('persists one complete assistant stream before returning it', async () => {
  const state = fixture([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'complete' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const result = await state.execution.execute(state.request)
  expect(result.message.content).toEqual([{ type: 'text', text: 'complete' }])
  expect(state.pending.map(event => event.type)).toEqual(['assistant/message'])
  expect(state.persisted()).toBe(1)
})

it('records an attempt without persisting a fabricated assistant when finish is missing', async () => {
  const state = fixture([{ type: 'text-delta', index: 0, text: 'partial' }])
  await expect(state.execution.execute(state.request)).rejects.toThrow('without terminal finish')
  expect(state.pending.map(event => event.type)).toEqual(['assistant/attempt'])
  expect(state.persisted()).toBe(0)
})

it('rejects output after finish and retains the streamed attempt', async () => {
  const state = fixture([
    { type: 'finish', reason: { kind: 'stop' } },
    { type: 'text-delta', index: 0, text: 'late' },
  ])
  await expect(state.execution.execute(state.request)).rejects.toThrow('after terminal finish')
  expect(state.pending.map(event => event.type)).toEqual(['assistant/attempt'])
})

it('drains adapter cleanup after cancellation at a yielded chunk and retains the request error', async () => {
  const caller = new AbortController()
  const primary = new Error('request cancelled after yield')
  const cleanupFailure = new Error('adapter stream cleanup failed')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  class Adapter extends LlmAdapter {
    async * stream(): AsyncIterable<StreamChunk> {
      try {
        caller.abort(primary)
        yield { type: 'text-delta', index: 0, text: 'cancelled' }
      } finally {
        entered.resolve(undefined)
        await release.promise
        throw cleanupFailure
      }
    }
  }
  const model = new NativeAdapterModel(new Adapter(), new AbortController().signal)
  const stream = model.stream({
    provider: 'fixture', model: 'fixture', messages: [], tools: [], signal: caller.signal,
  })[Symbol.asyncIterator]()
  let requestSettled = false
  const request = expect(stream.next()).rejects.toBe(primary).then(() => { requestSettled = true })
  await entered.promise
  let closeSettled = false
  const closing = model.close()
  const closed = expect(closing).rejects.toBe(cleanupFailure).then(() => { closeSettled = true })
  expect(model.close()).toBe(closing)
  try {
    await new Promise(resolve => setImmediate(resolve))
    expect(requestSettled).toBe(false)
    expect(closeSettled).toBe(false)
  } finally {
    release.resolve(undefined)
  }
  await request
  await closed
})

it('forwards image pricing until the selected adapter installation closes', async () => {
  const pricing = { priceImages: () => [] }
  const calls: [string, string][] = []
  class Adapter extends LlmAdapter {
    override imageRequestPricing(provider: string, model: string) {
      calls.push([provider, model])
      return pricing
    }

    async * stream(): AsyncIterable<StreamChunk> {}
  }
  const model = new NativeAdapterModel(new Adapter(), new AbortController().signal)

  expect(model.imageRequestPricing('deepseek-official', 'vision')).toBe(pricing)
  expect(calls).toEqual([['deepseek-official', 'vision']])

  await model.close()
  expect(() => model.imageRequestPricing('deepseek-official', 'vision'))
    .toThrow('native-model-execution: adapter Provider removed')
  expect(calls).toEqual([['deepseek-official', 'vision']])
})
