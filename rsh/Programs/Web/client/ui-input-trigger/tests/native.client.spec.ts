/**
 * Native entry: the service that owns the roster and one controller per Session.
 *
 * These tests drive the real `InputTriggerController` — not a stand-in — so a
 * pass here means the browser pipeline itself ran under the Native adapter. The
 * Session read face is a hand-written two-line observable, which is the point of
 * declaring it structurally in `src/native.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputTriggerSource } from '../src/types.ts'
import type { NativeSessionReadFace } from '../src/native.ts'
import { createNativeInputTrigger, nativeActx } from '../src/native.ts'

/** A Session read face whose selection and list the test owns. */
function sessionFace(initial: readonly SessionId[] = [], selected?: SessionId) {
  let snapshot = {
    selected,
    sessions: initial.map(id => ({ header: { id } })),
  } as NativeSessionReadFace['getSnapshot'] extends () => infer R ? R : never
  const listeners = new Set<() => void>()
  const face: NativeSessionReadFace = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const publish = (next: typeof snapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  return {
    face,
    published: listeners,
    select(id: SessionId | undefined, extra: readonly SessionId[] = []): void {
      const ids = [...new Set([...initial, ...extra])]
      publish({ selected: id, sessions: ids.map((sessionId: SessionId) => ({ header: { id: sessionId } })) })
    },
    remove(id: SessionId, keep: readonly SessionId[] = []): void {
      const next = id === snapshot.selected ? undefined : snapshot.selected
      publish({ selected: next, sessions: keep.map((sessionId: SessionId) => ({ header: { id: sessionId } })) })
    },
  }
}

/** A source that answers one trigger with a fixed candidate list and counts its calls. */
function source(name: string, trigger: '/' | '@', candidates: readonly string[]) {
  const calls = { candidates: 0, warm: 0 }
  const value: InputTriggerSource = {
    name,
    trigger,
    warm: () => { calls.warm += 1 },
    candidates: async () => {
      calls.candidates += 1
      return candidates.map(entry => ({ name: entry }))
    },
    onPick: () => ({ text: `picked ${name}` }),
  }
  return { value, calls }
}

const sessionA = 'session-a' as SessionId
const sessionB = 'session-b' as SessionId

describe('native trigger service', () => {
  it('exposes the selected Session and nothing while no Session is open', () => {
    const sessions = sessionFace([sessionA])
    const service = createNativeInputTrigger(sessions.face)
    expect(service.current()).toBeUndefined()
    sessions.select(sessionA, [sessionA])
    expect(service.current()).toBeDefined()
  })

  it('hands every source the same controller for one Session', () => {
    const sessions = sessionFace([sessionA], sessionA)
    const service = createNativeInputTrigger(sessions.face)
    expect(service.sessionOf(sessionA)).toBe(service.sessionOf(sessionA))
  })

  it('keeps one controller per Session', () => {
    const sessions = sessionFace([sessionA, sessionB], sessionA)
    const service = createNativeInputTrigger(sessions.face)
    expect(service.sessionOf(sessionA)).not.toBe(service.sessionOf(sessionB))
  })

  it('rejects a duplicate trigger and name', () => {
    const service = createNativeInputTrigger(sessionFace().face)
    service.registerSource(source('command', '/', []).value)
    expect(() => service.registerSource(source('command', '/', []).value)).toThrow(/already registered/u)
  })

  it('allows the same name on two different triggers', () => {
    const service = createNativeInputTrigger(sessionFace().face)
    service.registerSource(source('file', '@', []).value)
    expect(() => service.registerSource(source('file', '/', []).value)).not.toThrow()
  })

  it('replays late registration onto a controller created afterwards', () => {
    const sessions = sessionFace([sessionA], sessionA)
    const service = createNativeInputTrigger(sessions.face)
    const command = source('command', '/', ['goal'])
    service.registerSource(command.value)
    // The controller does not exist yet; creating it must warm every source.
    service.sessionOf(sessionA)
    expect(command.calls.warm).toBe(1)
  })

  it('notifies a live controller when a source arrives later', () => {
    const sessions = sessionFace([sessionA], sessionA)
    const service = createNativeInputTrigger(sessions.face)
    const session = service.sessionOf(sessionA)
    const late = source('late', '/', ['x'])
    service.registerSource(late.value)
    expect(late.calls.warm).toBe(1)

    session.track('/', 1, { tier: 'plain' }, 1)
    const state = session.menu.getSnapshot()
    expect(state.open).toBe(true)
    expect(state.groups.map(group => group.source)).toContain('late')
  })

  it('opens the menu from a tracked trigger and closes it on dismiss', () => {
    const sessions = sessionFace([sessionA], sessionA)
    const service = createNativeInputTrigger(sessions.face)
    service.registerSource(source('command', '/', ['goal']).value)
    const session = service.sessionOf(sessionA)

    session.track('/', 1, { tier: 'plain' }, 1)
    expect(session.menu.getSnapshot().open).toBe(true)
    session.dismiss()
    expect(session.menu.getSnapshot().open).toBe(false)
  })

  it('drops a Session controller when the Session leaves the Host list', () => {
    const sessions = sessionFace([sessionA, sessionB], sessionA)
    const service = createNativeInputTrigger(sessions.face)
    const first = service.sessionOf(sessionA)
    service.sessionOf(sessionB)

    // session-a disappears from the list: its controller must be released,
    // and asking again must mint a fresh one rather than reuse the dead object.
    sessions.remove(sessionB, [sessionB])
    const again = service.sessionOf(sessionA)
    expect(again).not.toBe(first)
  })

  it('notifies roster subscribers and stops after the disposer runs', () => {
    const service = createNativeInputTrigger(sessionFace().face)
    let changes = 0
    const off = service.subscribe(() => { changes += 1 })
    const registered = source('command', '/', [])
    const remove = service.registerSource(registered.value)
    expect(changes).toBe(1)
    remove()
    expect(changes).toBe(2)
    off()
    service.registerSource(source('other', '/', []).value)
    expect(changes).toBe(2)
  })

  it('releases every controller on dispose and refuses later registration', () => {
    const sessions = sessionFace([sessionA], sessionA)
    const service = createNativeInputTrigger(sessions.face)
    service.sessionOf(sessionA)
    service.dispose()
    expect(() => service.registerSource(source('after', '/', []).value)).toThrow(/disposed/u)
  })
})

describe('native input dispatch adapter', () => {
  it('maps the three Cordis bail events onto the dispatch kinds', () => {
    const seen: string[] = []
    const actx = nativeActx((event) => { seen.push(event.kind); return true })
    const bail = (actx as unknown as { bail: (s: unknown, e: string, p: object) => boolean }).bail
    expect(bail({}, 'slash/input-begin-command', { claim: {}, span: {} })).toBe(true)
    expect(bail({}, 'slash/input-insert-text', { text: 'x', span: {} })).toBe(true)
    expect(bail({}, 'slash/input-insert-reference', { reference: {}, span: {} })).toBe(true)
    expect(seen).toEqual(['begin-command', 'insert-text', 'insert-reference'])
  })

  it('reports an unapplied pick when the dispatcher declines', () => {
    const actx = nativeActx(() => false)
    const bail = (actx as unknown as { bail: (s: unknown, e: string, p: object) => boolean }).bail
    expect(bail({}, 'slash/input-insert-text', { text: 'x', span: {} })).toBe(false)
  })

  it('answers false for an event the pick pipeline never emits', () => {
    const actx = nativeActx(() => true)
    const bail = (actx as unknown as { bail: (s: unknown, e: string, p: object) => boolean }).bail
    // consume-token is a real Cordis slash event but not part of a pick.
    expect(bail({}, 'slash/input-consume-token', { guard: {} })).toBe(false)
  })
})
