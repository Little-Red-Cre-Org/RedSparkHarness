/** Synchronous native and compatibility Session acceptance guards. */
import { expect, it } from 'vitest'
import { Session, SessionId } from '../src/native.ts'

it('rejects a guarded append without changing the log or the next sequence', () => {
  const session = Session.create(SessionId('append-guard'))
  const failure = new Error('resource is active')
  const remove = session.onBeforeAppend((event) => {
    expect(Object.isFrozen(event)).toBe(true)
    expect(event.seq).toBe(0)
    expect(session.seq).toBe(0)
    throw failure
  })
  expect(() => session.append('turn/start', { turn: 1 })).toThrow(failure)
  expect(session.seq).toBe(0)
  expect(session.snapshotEvents()).toEqual([])
  remove()
  expect(session.append('turn/start', { turn: 1 }).seq).toBe(0)
})

it('owns each registration and rejects guard reentrancy without invoking later guards', () => {
  const session = Session.create(SessionId('guard-ownership'))
  let calls = 0
  const callback = () => { calls++ }
  const first = session.onBeforeAppend(callback)
  const second = session.onBeforeAppend(callback)
  first()
  first()
  session.append('turn/start', { turn: 1 })
  expect(calls).toBe(1)
  second()
  const remove = session.onBeforeAppend(() => { session.append('turn/start', { turn: 2 }) })
  const later = session.onBeforeAppend(callback)
  expect(() => session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })).toThrow('cannot reenter')
  expect(session.seq).toBe(1)
  expect(calls).toBe(1)
  remove()
  later()
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect(session.seq).toBe(2)
})
