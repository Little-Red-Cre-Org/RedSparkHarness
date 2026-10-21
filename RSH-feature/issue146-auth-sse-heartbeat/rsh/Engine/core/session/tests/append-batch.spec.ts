/** Related facts are rejected together before publication or surface changes. */
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { Session, SessionId, SessionSeq } from '../src/native.ts'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '../src/index.ts'

it('publishes the complete accepted batch in order through the existing store', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('batch-publication'))
  const observed: { session: Session; length: number; seq: number }[] = []
  ctx.on('session/event', (current, event) => {
    observed.push({ session: current, length: current.seq, seq: event.seq })
  })
  session.appendBatch([{ type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }])
  expect(observed).toEqual([{ session, length: 2, seq: 0 }, { session, length: 2, seq: 1 }])
})

it('rejects every fact when a later guard vetoes the batch', () => {
  const session = Session.create(SessionId('batch-veto'))
  session.onBeforeAppend((event) => {
    expect(session.seq).toBe(0)
    if (event.type === 'turn/end') throw new Error('veto')
  })
  expect(() => session.appendBatch([
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ])).toThrow('veto')
  expect(session.snapshotEvents()).toEqual([])
})

it('abandons prospective invariant state after a later dispatch veto', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('batch-dispatch-veto'))
  const published: number[] = []
  ctx.on('session/event', (_current, event) => { published.push(event.seq) })
  const remove = ctx.on('internal/dispatch', (_mode, name, args) => {
    if (name === 'session/event' && (args[1] as { type: string }).type === 'turn/end') throw new Error('dispatch veto')
  })
  expect(() => session.appendBatch([{ type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }])).toThrow('dispatch veto')
  expect(session.seq).toBe(0)
  expect(published).toEqual([])
  remove()
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect(published).toEqual([0, 1])
})

it('accepts immutable contiguous facts and derives their surface in order', () => {
  const session = Session.create(SessionId('batch-surface'))
  const message = createUserMessage({ content: [{ type: 'text', text: 'batch' }], source: { kind: 'user' } })
  const events = session.appendBatch([
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: message, opts: { surfaceOp: 'append' } },
  ])
  expect(events.map(event => event.seq)).toEqual([0, 1])
  expect(Object.isFrozen(events)).toBe(true)
  expect(Object.isFrozen(events[1]?.data)).toBe(true)
  expect(session.surface.nodes).toEqual([1])
  expect(session.append('turn/start', { turn: 2 }).seq).toBe(2)
})

it('rejects recursive appends from a batch guard without accepting its prefix', () => {
  const session = Session.create(SessionId('batch-reentry'))
  session.onBeforeAppend(() => { session.append('turn/start', { turn: 2 }) })
  expect(() => session.appendBatch([{ type: 'turn/start', data: { turn: 1 } }])).toThrow('cannot reenter')
  expect(session.seq).toBe(0)
})

it('rejects a later invalid surface transition without accepting preceding facts', () => {
  const session = Session.create(SessionId('batch-invalid-surface'))
  const message = createUserMessage({ content: [{ type: 'text', text: 'batch' }], source: { kind: 'user' } })
  expect(() => session.appendBatch([
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: message, opts: { surfaceOp: 'append', sourceEventSeqs: [SessionSeq(99)] } },
  ])).toThrow()
  expect(session.seq).toBe(0)
  expect(session.surface.nodes).toEqual([])
})
