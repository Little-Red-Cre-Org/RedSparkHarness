/**
 * The Native pipeline's composer subscription.
 *
 * A trigger source nobody asks is indistinguishable from no source at all, so
 * what this file pins is the join: a draft the composer publishes becomes one
 * track() call at the published caret, an identical republish takes no second
 * call, and unloading stops the subscription.
 */
import { describe, expect, it, vi } from 'vitest'
import { plugin } from '../src/native.tsx'
import type { SessionId } from '@redspark/rsh-session/types'

/** A composer whose draft a test can publish. */
function composer() {
  let value = { text: '', caret: 0 }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    replaceToken: vi.fn(),
    publish(next: { text: string; caret: number }) {
      value = next
      for (const listener of listeners) listener()
    },
    listeners,
  }
}

/**
 * Install the plugin against a hand-written context.
 * @param selected - the conversation's selected Session, if any.
 * @returns the published service, the composer, and the tracked Session stub.
 */
function install(selected: SessionId | undefined) {
  const draft = composer()
  let current = selected
  const conversationListeners = new Set<() => void>()
  const services: Record<string, unknown> = {
    clientNativeConversation: {
      getSnapshot: () => ({ selected: current, sessions: [] }),
      subscribe: (listener: () => void) => {
        conversationListeners.add(listener)
        return () => { conversationListeners.delete(listener) }
      },
    },
    clientNativeComposer: draft,
    clientLocale: { register: () => () => {}, bind: () => () => 'label' },
  }
  const owned: (() => void)[] = []
  const tracked = { track: vi.fn(), dispose: vi.fn() }
  const context = {
    require: (name: string) => services[name],
    optional: (name: string) => services[name],
    provide: (name: string, service: unknown) => { services[name] = service },
    own: (fn: () => void) => { owned.push(fn) },
  }
  const resolved = plugin.resolve(undefined) as unknown as (ctx: unknown) => void
  resolved(context)
  const service = services.clientNativeInputTrigger as {
    current(): { track: unknown } | undefined
  }
  // Every Session resolves to the same stub, so each track call is observable
  // without standing up the controller's own scopes.
  const sessionOf = vi.fn(() => tracked)
  Object.assign(service, { sessionOf })
  return {
    draft, service, owned, tracked, sessionOf,
    // Switching Sessions in the conversation is what a click in the sidebar does.
    select: (next: SessionId | undefined): void => {
      current = next
      for (const listener of conversationListeners) listener()
    },
  }
}

const SID = 'session-1' as SessionId

describe('composer subscription', () => {
  it('tracks the published draft at the published caret', () => {
    const { draft, tracked } = install(SID)
    draft.publish({ text: 'see @src', caret: 8 })
    expect(tracked.track).toHaveBeenCalledTimes(1)
    expect(tracked.track).toHaveBeenCalledWith('see @src', 8, { tier: 'plain' }, 8)
  })

  it('takes no second call for a republished identical draft', () => {
    const { draft, tracked } = install(SID)
    draft.publish({ text: '@s', caret: 2 })
    draft.publish({ text: '@s', caret: 2 })
    expect(tracked.track).toHaveBeenCalledTimes(1)
    draft.publish({ text: '@sy', caret: 3 })
    expect(tracked.track).toHaveBeenCalledTimes(2)
  })

  it('stops tracking once the installation unloads', () => {
    const { draft, tracked, owned } = install(SID)
    draft.publish({ text: '@', caret: 1 })
    for (const dispose of owned) dispose()
    draft.publish({ text: '@s', caret: 2 })
    expect(tracked.track).toHaveBeenCalledTimes(1)
    expect(draft.listeners.size).toBe(0)
  })

  it('tracks the newly selected Session without waiting for a keystroke', () => {
    const { draft, tracked, select } = install(SID)
    draft.publish({ text: '@s', caret: 2 })
    expect(tracked.track).toHaveBeenCalledTimes(1)
    select('session-2' as SessionId)
    // The draft is unchanged, so only the selection change can have asked.
    expect(tracked.track).toHaveBeenCalledTimes(2)
    expect(tracked.track).toHaveBeenLastCalledWith('@s', 2, { tier: 'plain' }, 2)
  })

  it('asks for no Session while none is selected', () => {
    const { draft, tracked, sessionOf } = install(undefined)
    draft.publish({ text: '@s', caret: 2 })
    // Reading a Session the conversation has not selected would scope the
    // controller to a Session that cannot receive the pick.
    expect(sessionOf).not.toHaveBeenCalled()
    expect(tracked.track).not.toHaveBeenCalled()
  })
})
