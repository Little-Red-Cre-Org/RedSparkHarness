// @vitest-environment jsdom
/**
 * Native companion entry.
 *
 * The browser half reads a Session projection and a settings scope; the Native
 * half reads the one Conversation service and keeps its registry in the browser
 * process. This suite pins what the Native half owns: the registry contract,
 * the state derivation from the controller lifecycle, and the overlay
 * registration into the shell root.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createSnapshotStore } from '@redspark/rsh-client-store'
import type { SnapshotSelectorHook, TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { SessionId } from '@redspark/rsh-session/types'
import { bindSnapshotSelector, makeTranslate } from '@redspark/rsh-client-test-runtime'
import { createNativePetService, derivePetActivity, NativePetOverlay } from '../src/native.ts'
import type { NativePetConversation, NativePetSnapshot } from '../src/native.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SID = 'native-pet-session' as SessionId

/** A Conversation view with only the fields the overlay reads. */
function conversation(changes: Partial<NativePetConversation> = {}): NativePetConversation {
  return { selected: SID, state: 'ready', ...changes }
}

function overlayProps(pet: NativePetSnapshot, view: NativePetConversation, t: TranslateNS<'pet'> = makeTranslate(en) as never) {
  return {
    usePet: bindSnapshotSelector(createSnapshotStore(pet)) as SnapshotSelectorHook<NativePetSnapshot>,
    useConversation: bindSnapshotSelector(createSnapshotStore(view)) as SnapshotSelectorHook<NativePetConversation>,
    t,
  }
}

describe('native pet registry', () => {
  it('registers a character once and refuses a duplicate id', () => {
    const pet = createNativePetService()
    pet.register({ id: 'fox', name: 'Fox', variants: [{ id: 'normal', atlasUrl: '/fox.png' }] })
    expect(() => pet.register({ id: 'fox', name: 'Other', variants: [{ id: 'normal', atlasUrl: '/x.png' }] }))
      .toThrow('is already registered')
  })

  it('refuses a character with no variant', () => {
    const pet = createNativePetService()
    expect(() => pet.register({ id: 'empty', name: 'Empty', variants: [] })).toThrow('has no variants')
  })

  it('removes only its own registration', () => {
    const pet = createNativePetService()
    const disposeFox = pet.register({ id: 'fox', name: 'Fox', variants: [{ id: 'normal', atlasUrl: '/fox.png' }] })
    pet.register({ id: 'cat', name: 'Cat', variants: [{ id: 'normal', atlasUrl: '/cat.png' }] })
    disposeFox()
    expect(pet.getSnapshot().pets.map(entry => entry.id)).toEqual(['cat'])
  })

  it('keeps the selected variant when it exists and falls back to the first otherwise', () => {
    const pet = createNativePetService()
    pet.register({
      id: 'fox', name: 'Fox',
      variants: [{ id: 'normal', atlasUrl: '/fox.png' }, { id: 'chibi', atlasUrl: '/chibi.png' }],
    })
    pet.selectPet('fox')
    expect(pet.getSnapshot().variant).toBe('normal')
    pet.selectVariant('chibi')
    pet.selectPet('fox')
    expect(pet.getSnapshot().variant).toBe('chibi')
    pet.selectVariant('missing')
    pet.selectPet('fox')
    expect(pet.getSnapshot().variant).toBe('normal')
  })

  it('rejects selecting an unregistered character', () => {
    const pet = createNativePetService()
    expect(() => pet.selectPet('ghost')).toThrow('is not registered')
  })

  it('publishes a new snapshot only when a preference actually changes', () => {
    const pet = createNativePetService()
    const listener = vi.fn()
    pet.subscribe(listener)
    const before = pet.getSnapshot()
    pet.setEnabled(true)
    expect(pet.getSnapshot()).toBe(before)
    pet.setEnabled(false)
    expect(listener).toHaveBeenCalledOnce()
    expect(pet.getSnapshot()).not.toBe(before)
  })
})

describe('native pet activity', () => {
  it('maps the controller lifecycle onto the presented states', () => {
    expect(derivePetActivity(conversation())).toBe('idle')
    expect(derivePetActivity(conversation({ state: 'sending' }))).toBe('thinking')
    expect(derivePetActivity(conversation({ state: 'cancelling' }))).toBe('thinking')
    expect(derivePetActivity(conversation({ state: 'loading' }))).toBe('thinking')
    expect(derivePetActivity(conversation({ error: 'connection reset' }))).toBe('error')
  })
})

describe('native pet overlay', () => {
  it('renders nothing without a selected Session', () => {
    const pet = createNativePetService()
    pet.register({ id: 'redspark-kitsune', name: 'Kitsune', variants: [{ id: 'normal', atlasUrl: '/k.png' }] })
    const view = render(<NativePetOverlay {...overlayProps(pet.getSnapshot(), conversation({ selected: undefined }))} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('renders nothing while the companion is disabled', () => {
    const pet = createNativePetService()
    pet.register({ id: 'redspark-kitsune', name: 'Kitsune', variants: [{ id: 'normal', atlasUrl: '/k.png' }] })
    pet.setEnabled(false)
    const view = render(<NativePetOverlay {...overlayProps(pet.getSnapshot(), conversation())} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('presents the selected atlas and localized status', () => {
    const pet = createNativePetService()
    pet.register({ id: 'redspark-kitsune', name: 'Kitsune', variants: [{ id: 'normal', atlasUrl: '/k.png' }] })
    const view = render(<NativePetOverlay {...overlayProps(pet.getSnapshot(), conversation())} />)
    expect(view.getByRole('status').textContent).toBe(en['speech.idle'].replace('{name}', 'Kitsune'))
    expect(view.getByRole('img').getAttribute('style')).toContain('/k.png')
  })

  it('speaks the thinking line while a turn runs', () => {
    const pet = createNativePetService()
    pet.register({ id: 'redspark-kitsune', name: 'Kitsune', variants: [{ id: 'normal', atlasUrl: '/k.png' }] })
    const view = render(<NativePetOverlay {...overlayProps(
      pet.getSnapshot(), conversation({ state: 'sending' }), makeTranslate(zh) as never,
    )} />)
    expect(view.getByRole('status').textContent).toBe(zh['speech.thinking'].replace('{name}', '赤绯'))
  })
})

describe('native pet dictionaries', () => {
  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

/** Reference the imported hook type so an unused-import warning cannot hide a real break. */
void (null as unknown as SnapshotSelectorHook<NativePetSnapshot>)