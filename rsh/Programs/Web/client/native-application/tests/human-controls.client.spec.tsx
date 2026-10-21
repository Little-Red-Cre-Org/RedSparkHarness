// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionSeq, type SessionId, type SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionClient, NativeWebHumanPrompt } from '@deepseek-ai/dsh-client-native-session/native'
import { createNativeSessionClient } from '../../native-session/src/native.ts'
import { NativeConversationController } from '../src/controller.ts'
import { HumanInteraction } from '../src/human.tsx'

afterEach(cleanup)

function fixture() {
  const header = (id: SessionId): SessionHeader => ({ id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false })
  const rows = ['alpha', 'beta'].map(value => ({ header: header(value as SessionId),
    titleProjection: { status: 'absent' as const }, updatedAt: 1, blank: true, running: false,
    completed: false, runningSubagentCount: 0, hasActiveSchedule: false }))
  const answers: ReturnType<typeof Promise.withResolvers<undefined>>[] = []
  const turns: { observe: Parameters<NativeSessionClient['prompt']>[4]
    settled: ReturnType<typeof Promise.withResolvers<{ exitCode: number; answer: string }>> }[] = []
  const transport = createNativeSessionClient({ async call() { throw new Error('unexpected transport call') } },
    { maxFollowBufferChars: 10_000 })
  const answerHuman = vi.fn<NativeSessionClient['answerHuman']>(() => {
    const answer = Promise.withResolvers<undefined>()
    answers.push(answer)
    return answer.promise
  })
  const client: NativeSessionClient = {
    ...transport, answerHuman,
    async list() { return rows },
    async *follow(signal) {
      yield { type: 'baseline', items: rows }
      if (!signal.aborted) await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    },
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    async history(id) { return { header: header(id), events: [
      { type: 'session/end-seed', seq: SessionSeq(0), time: 1, data: {} },
    ], inheritedEventCount: 0 } },
    prompt(_id, _text, _resume, _signal, observe) {
      const settled = Promise.withResolvers<{ exitCode: number; answer: string }>()
      turns.push({ observe, settled })
      return settled.promise
    },
  }
  const controller = new NativeConversationController(client, { maxLiveTextChars: 1_000, maxLiveEvents: 100 })
  return { controller, answers, turns, answerHuman,
    present(prompt: NativeWebHumanPrompt) { turns.at(-1)?.observe?.({ type: 'human', prompt }) },
    async close() {
      for (const answer of answers) answer.resolve(undefined)
      for (const turn of turns) turn.settled.resolve({ exitCode: 0, answer: '' })
      await controller.close()
    } }
}

function Human({ controller }: { controller: NativeConversationController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return snapshot.human === undefined ? null : <HumanInteraction key={snapshot.human.id}
    prompt={snapshot.human} locale="en" disabled={snapshot.answeringHuman === true}
    answerHuman={controller.answerHuman.bind(controller)} />
}

it.each([{ message: 'answer transport failed' }])('retries the same question batch after a failed dismissal ($message)', async ({ message }) => {
  const state = fixture()
  const prompt: NativeWebHumanPrompt = { kind: 'questions', id: 'question' as NativeWebHumanPrompt['id'],
    questions: [{ id: 'first', question: 'Continue?' }, { id: 'second', question: 'Which route?' }] }
  try {
    await state.controller.load()
    await state.controller.select('alpha' as SessionId)
    const sending = state.controller.send('Ask me')
    state.present(prompt)
    render(<Human controller={state.controller} />)
    const dismiss = screen.getByRole('button', { name: 'Dismiss all questions' })
    fireEvent.click(dismiss)
    fireEvent.click(dismiss)
    expect(state.answerHuman).toHaveBeenCalledTimes(1)
    expect(() => state.controller.answerHuman(prompt, { kind: 'cancel-questions' })).toThrow('no matching unanswered presentation')
    expect(state.controller.getSnapshot()).toMatchObject({ human: prompt, answeringHuman: true, state: 'sending' })
    await act(async () => { state.answers[0]?.reject(new Error(message)) })
    await waitFor(() => { expect(dismiss).not.toHaveProperty('disabled', true) })
    expect(state.controller.getSnapshot()).toMatchObject({ human: prompt, error: message, answeringHuman: false })
    fireEvent.click(dismiss)
    expect(state.answerHuman).toHaveBeenCalledTimes(2)
    expect(state.answerHuman.mock.calls[1]?.slice(0, 3)).toEqual(['alpha', prompt.id, { kind: 'cancel-questions' }])
    await act(async () => { state.answers[1]?.resolve(undefined) })
    expect(state.controller.getSnapshot()).toMatchObject({ human: prompt, error: undefined, state: 'sending' })
    await act(async () => {
      state.turns[0]?.observe?.({ type: 'human-removed', id: prompt.id })
      state.turns[0]?.settled.resolve({ exitCode: 0, answer: 'Continued' })
      await sending
    })
    expect(screen.queryByRole('button', { name: 'Dismiss all questions' })).toBeNull()
    expect(() => state.controller.answerHuman(prompt, { kind: 'cancel-questions' })).toThrow('no matching unanswered presentation')
  } finally { await state.close() }
})

it.each([{ oldError: 'old answer failed' }])('isolates late acknowledgements across prompts and Sessions ($oldError)', async ({ oldError }) => {
  const state = fixture()
  const prompt = (id: string): NativeWebHumanPrompt => ({ kind: 'approval',
    id: id as NativeWebHumanPrompt['id'], toolName: 'write', canAllowSession: true })
  try {
    await state.controller.load()
    await state.controller.select('alpha' as SessionId)
    const firstTurn = state.controller.send('First task')
    const first = prompt('first')
    state.present(first)
    const oldAnswer = state.controller.answerHuman(first, { kind: 'approval', outcome: 'allowed-session' })
    const second = prompt('second')
    state.present(second)
    const currentAnswer = state.controller.answerHuman(second, { kind: 'approval', outcome: 'allowed-once' })
    state.answers[0]?.reject(new Error(oldError))
    await oldAnswer
    expect(state.controller.getSnapshot()).toMatchObject({ human: second, answeringHuman: true, error: undefined })
    expect(() => state.controller.answerHuman(second, { kind: 'approval', outcome: 'rejected' })).toThrow('no matching unanswered presentation')
    state.turns[0]?.settled.resolve({ exitCode: 0, answer: 'Done' })
    await firstTurn
    await state.controller.select('beta' as SessionId)
    const secondTurn = state.controller.send('Second task')
    const third = prompt('third')
    state.present(third)
    const newestAnswer = state.controller.answerHuman(third, { kind: 'approval', outcome: 'rejected' })
    state.answers[1]?.resolve(undefined)
    await currentAnswer
    expect(state.controller.getSnapshot()).toMatchObject({ selected: 'beta', human: third, answeringHuman: true, error: undefined })
    state.answers[2]?.reject(new Error('current answer failed'))
    await newestAnswer
    expect(state.controller.getSnapshot()).toMatchObject({ human: third, answeringHuman: false, error: 'current answer failed' })
    state.turns[1]?.settled.resolve({ exitCode: 0, answer: 'Done' })
    await secondTurn
  } finally { await state.close() }
})
