/** Stream settlement records a completed assistant or a partial attempt. */
import { expect, it } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { NativeModelExecution } from '../src/index.ts'

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
