/** Actual Program maintenance owns model intent, persistence and async admission. */
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { ReasoningEffortId, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm/native'
import type { NativeModel } from '@deepseek-ai/dsh-native-model-execution'
import { fixture, readEvents } from './native-fixture.ts'

it('uses prepared defaults instead of advisory defaults and changes them after a cold restoration', async () => {
  const requests: GenerateOptions[] = []
  let unavailable = false
  const unavailableError = new Error('selected model unavailable')
  const modelFor = (cap: number, effort: string): NativeModel => ({
    async prepareCall(provider, id) {
      if (unavailable) throw unavailableError
      return { model: { provider, id, name: id, defaultMaxTokens: cap,
        reasoning: { efforts: [{ id: ReasoningEffortId(effort), name: effort }], defaultEffort: ReasoningEffortId(effort) } },
      async *stream(options) { requests.push(options); yield { type: 'finish', reason: { kind: 'stop' } } } } },
    async *stream() { throw new Error('prepared dispatch is required') },
  })
  const advisory = async (provider: string, id: string) => ({ provider, id, name: id, defaultMaxTokens: 128,
    reasoning: { efforts: [{ id: ReasoningEffortId('medium'), name: 'Medium' }], defaultEffort: ReasoningEffortId('medium') } })
  const first = await fixture(advisory, { model: modelFor(256, 'high'), preserve: true })
  const id = SessionId('prepared-selection-cold')
  const message = createUserMessage({ content: [{ type: 'text', text: 'Resolve selected defaults.' }], source: { kind: 'user' } })
  try {
    await first.roots.maintenance({ route: first.route, id, resume: false }, async (owner, signal) => {
      const receipt = await first.selection.select(owner,
        { selected: { provider: 'fixture', model: 'default' }, expectedRevision: null }, signal)
      expect(receipt.selected).toEqual({ provider: 'fixture', model: 'default' })
    }, new AbortController().signal)
    await first.roots.execute({ route: first.route, id, resume: true, message }, new AbortController().signal)
  }
  finally { await first.close() }
  const second = await fixture(advisory, { model: modelFor(512, 'low'), home: first.home })
  try {
    unavailable = true
    await expect(second.roots.execute({ route: second.route, id, resume: true, message }, new AbortController().signal))
      .rejects.toBe(unavailableError)
    const refused = await readEvents(second.storage, id)
    expect(refused.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(1)
    expect(refused.findLast(event => event.type === 'agent/inbox/spliced')?.data.inserted).toEqual([message])
    unavailable = false
    await second.roots.execute({ route: second.route, id, resume: true }, new AbortController().signal)
    expect((await readEvents(second.storage, id)).filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(2)
    expect(requests.map(request => [request.maxTokens, request.reasoningEffort])).toEqual([[256, 'high'], [512, 'low']])
    const headers = (await readEvents(second.storage, id)).filter(event => event.type === 'request/header')
    expect(headers.map(event => [event.data.header.config.maxTokens, event.data.header.config.reasoningEffort]))
      .toEqual([[256, 'high'], [512, 'low']])
  } finally { await second.close() }
})


it('admits only one simultaneous choice against the same durable intent revision', async () => {
  const state = await fixture()
  const id = SessionId('selection-simultaneous')
  try {
    await state.roots.maintenance({ route: state.route, id, resume: false }, async (owner, signal) => {
      const outcomes = await Promise.allSettled(['first', 'second'].map(model => state.selection.select(owner,
        { selected: { provider: 'fixture', model }, expectedRevision: null }, signal)))
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1)
    }, new AbortController().signal)
    expect((await readEvents(state.storage, id)).filter(event => event.type === 'model/selection')).toHaveLength(1)
  } finally { await state.close() }
})
