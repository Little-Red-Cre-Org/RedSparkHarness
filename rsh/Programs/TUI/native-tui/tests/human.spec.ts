/** Exact terminal request ownership and stale-answer cancellation without a second writer. */
import { expect, it, vi } from 'vitest'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import { NativeScope, ResourceOwner } from '@deepseek-ai/dsh-native-runtime'
import { NativeApprovalRequestId, type NativeApprovalAnswerer, type NativeApprovalAnswererRequest } from '@deepseek-ai/dsh-native-approval'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeUserQuestionAnswerer } from '@deepseek-ai/dsh-user-questions/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { TerminalController } from '../src/controller.ts'
import { bindTerminalHumanAnswerers } from '../src/human.ts'
import { resolveNativeTuiConfig } from '../src/config.ts'

it('answers exact root requests, refuses stale input and drains cancelled or removed presentations', async () => {
  const id = SessionId('terminal-human')
  const agent = {} as NativeAgent // The port proof checks exact identity; the dsh snapshot owns the actual Agent and writer.
  const owner = { agent, invocation: 'root', session: { id } } as NativeActiveSessionOwner
  const config = resolveNativeTuiConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Terminal.',
    locale: 'en', background: '#000000', maxQueuedInputs: 1, maxHistoryEvents: 100, maxTranscriptEvents: 2,
    maxStreamChunks: 2, maxPendingHumanRequests: 2 })
  const lifetime = new AbortController()
  const controller = new TerminalController({ turn: async () => ({ exitCode: 0 }), open: async () => undefined,
    history: async () => [], sessions: async () => [] }, lifetime.signal, config, id)
  let approval!: NativeApprovalAnswerer
  let questions!: NativeUserQuestionAnswerer
  const removedApproval = vi.fn()
  const removedQuestions = vi.fn(async () => undefined)
  const active = { owners: () => [owner] }
  const scope = new NativeScope()
  const registrations = new ResourceOwner()
  const context = { scope, own: registrations.own.bind(registrations) }
  bindTerminalHumanAnswerers(controller.human, active, value => controller.ownsSession(value), context,
    { registerAnswerer: (answerer) => { approval = answerer; return removedApproval } },
    { registerAnswerer: (_name, answerer) => { questions = answerer; return removedQuestions } })
  const request: NativeApprovalAnswererRequest = { id: NativeApprovalRequestId('terminal-approval'), agent,
    toolName: 'write_file', reason: 'Write requested file', policy: 'ask', signal: lifetime.signal }
  try {
    await controller.initialize([], lifetime.signal)
    expect(controller.ownsSession(SessionId('another'))).toBe(false)
    expect(approval({ ...request, agent: {} as NativeAgent })).toBeUndefined()
    const delegated = vi.fn(async () => ({ answers: [] }))
    await questions.ask({ agent, session: { id: SessionId('another') } as NativeActiveSessionOwner['session'],
      questions: [], signal: lifetime.signal }, delegated)
    expect(delegated).toHaveBeenCalledOnce()
    const allowed = approval(request)
    const shown = controller.snapshot().human!
    expect(shown).toMatchObject({ kind: 'approval', toolName: 'write_file' })
    expect(() =>{  controller.answerHuman('yes', shown) }).toThrow('/allow')
    controller.answerHuman('/allow', shown)
    expect(await allowed).toBe('allowed-once')
    const cancelled = new AbortController()
    const { reason: _reason, ...withoutReason } = request
    const pending = approval({ ...withoutReason, signal: cancelled.signal })
    const stale = controller.snapshot().human!
    const rejection = expect(pending).rejects.toThrow('caller cancelled')
    cancelled.abort(new Error('caller cancelled'))
    await rejection
    await expect(approval({ ...request, signal: cancelled.signal })).rejects.toThrow('caller cancelled')
    const refused = approval(request)
    expect(() =>{  controller.answerHuman('/allow', stale) }).toThrow('No pending')
    controller.answerHuman('/deny', controller.snapshot().human!)
    expect(await refused).toBe('rejected')

    const answers = questions.ask({ agent, session: owner.session, signal: lifetime.signal, questions: [
      { id: 'one', question: 'Choose one', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'many', question: 'Choose several', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true },
      { id: 'custom', question: 'Other answer', options: [{ label: 'A' }] },
      { id: 'text', question: 'Write text' },
    ] }, delegated)
    const first = controller.snapshot().human!
    for (const input of ['', '/other', '/other ', '3', '1,1', '1,2']) {
      expect(() =>{  controller.answerHuman(input, first) }).toThrow('Enter option')
    }
    controller.answerHuman('2', first)
    await vi.waitFor(() =>{  expect(controller.snapshot().human).toMatchObject({ question: { id: 'many' } }) })
    controller.answerHuman('1,2', controller.snapshot().human!)
    await vi.waitFor(() =>{  expect(controller.snapshot().human).toMatchObject({ question: { id: 'custom' } }) })
    controller.answerHuman('/other custom answer', controller.snapshot().human!)
    await vi.waitFor(() =>{  expect(controller.snapshot().human).toMatchObject({ question: { id: 'text' } }) })
    controller.answerHuman('free text', controller.snapshot().human!)
    expect(await answers).toEqual({ answers: [
      { id: 'one', selected: ['B'] }, { id: 'many', selected: ['A', 'B'] },
      { id: 'custom', selected: [], custom: 'custom answer' }, { id: 'text', selected: [], custom: 'free text' },
    ] })
    expect(() =>{  controller.answerHuman('late', first) }).toThrow('No pending')
    const queued = [approval(request), approval(request)]
    const rejected = queued.map(operation => expect(operation).rejects.toThrow('closed'))
    await expect(approval(request)).rejects.toThrow('queue is full')
    await controller.close()
    await Promise.all(rejected)
    expect(controller.snapshot().human).toBeUndefined()
    expect(controller.ownsSession(id)).toBe(false)
    expect(approval(request)).toBeUndefined()
    await expect(controller.human.approval(request)).rejects.toThrow('closed')
  } finally { await controller.close(); await registrations.dispose() }
  expect(removedApproval).toHaveBeenCalledOnce()
  expect(removedQuestions).toHaveBeenCalledOnce()
  bindTerminalHumanAnswerers(controller.human, active, () => false, context)
})
