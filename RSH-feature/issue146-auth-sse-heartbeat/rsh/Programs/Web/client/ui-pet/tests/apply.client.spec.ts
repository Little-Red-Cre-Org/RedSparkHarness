import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PetSettings } from '../src/pet-settings.ts'
import { apply, inject } from '../src/client/index.ts'
import type { PetSettingsInjected } from '../src/client/PetSettingsRow.tsx'
import type { PetViewInjected } from '../src/client/PetView.tsx'

const SID = 'pet-apply' as SessionId
const absent = { getSnapshot: () => undefined, subscribe: () => () => {} }

interface ConversationSlot {
  name: 'conversation.pet'
  inject: (sessionId: SessionId | undefined) => PetViewInjected
}

interface SettingsSlot {
  id: 'personalization-pet'
  inject: () => PetSettingsInjected
}

function isConversationSlot(slot: ConversationSlot | SettingsSlot): slot is ConversationSlot {
  return 'name' in slot && slot.name === 'conversation.pet'
}

function isSettingsSlot(slot: ConversationSlot | SettingsSlot): slot is SettingsSlot {
  return 'id' in slot && slot.id === 'personalization-pet'
}

describe('ui-pet client apply', () => {
  it('provides the runtime, registers built-ins, and injects both presentation faces', async () => {
    const ctx = new Context()
    const settings = stubSettingsScope<PetSettings>()
    settings.publish({
      status: 'ready', writable: true, revision: 0,
      value: { enabled: true, desktopEnabled: false, petId: 'redspark-kitsune', variant: 'normal', customPets: [] },
    })
    const injectSlot = vi.fn((_name: string, setup: () => unknown) => { setup() })
    const registeredSlots: Array<ConversationSlot | SettingsSlot> = []
    const registerSlot = vi.fn((slot: ConversationSlot | SettingsSlot) => {
      registeredSlots.push(slot)
      return () => {}
    })
    const registerLocale = vi.fn(() => {
      return () => {}
    })
    const target = vi.fn(() => absent)
    const binding = vi.fn(() => ({ target }))
    const registerEvent = vi.fn()
    const registerView = vi.fn()

    ctx.provide('slots', { inject: injectSlot, register: registerSlot } as never)
    ctx.provide('locale', { register: registerLocale } as never)
    ctx.provide('remote', {} as never)
    ctx.provide('settingsScope', { bind: vi.fn(() => settings.scope) } as never)
    ctx.provide('sessions', { binding: vi.fn((sessionId: SessionId) => sessionId === SID ? {} : undefined) } as never)
    ctx.provide('uiConversation', {
      events: { register: registerEvent }, views: { register: registerView }, binding,
    } as never)

    const fiber = ctx.plugin({
      inject: [...inject],
      apply: (child) => {
        apply(child, { codingTools: ['edit'], planningTools: ['todo_write'], longRunningAfterMs: 1000 })
      },
    })
    await fiber.await()

    expect(ctx.get('pet')?.state.getSnapshot().pets).toMatchObject([{ id: 'redspark-kitsune', variants: [
      { id: 'normal', atlasUrl: '/brand/kitsune-sprites.png' }, { id: 'chibi', atlasUrl: '/brand/kitsune-chibi-sprites.png' },
    ] }])
    expect(registerLocale).toHaveBeenCalledWith('pet', expect.any(Object))
    expect(registerEvent).toHaveBeenCalledTimes(2)
    expect(registerView).toHaveBeenCalledTimes(1)

    const conversation = registeredSlots.find(isConversationSlot)
    const preferences = registeredSlots.find(isSettingsSlot)
    if (conversation === undefined || preferences === undefined) throw new Error('Expected both pet slots to register')
    const unboundLifecycle = conversation.inject(undefined).hooks.petLifecycle
    expect(unboundLifecycle.getSnapshot()).toBeUndefined()
    const unsubscribeUnbound = unboundLifecycle.subscribe(vi.fn())
    unsubscribeUnbound()
    expect(conversation.inject(SID).hooks.petLifecycle).toBe(absent)
    expect(binding).toHaveBeenCalledWith({})

    const settingsFace = preferences.inject()
    settingsFace.setEnabled(false)
    settingsFace.setDesktopEnabled(true)
    settingsFace.setPet('redspark-kitsune')
    settingsFace.setVariant('chibi')
    await expect(settingsFace.importPet('Imported', 'data:image/png;base64,aGVsbG8=')).rejects.toThrow('Pet import was not saved')
    await settingsFace.removePet('missing')
    expect(settings.set).toHaveBeenCalledWith('enabled', false)
    expect(settings.set).toHaveBeenCalledWith('desktopEnabled', true)
    expect(settings.set).toHaveBeenCalledWith('variant', 'chibi')
    expect(settings.mutate).toHaveBeenCalledTimes(3)
    expect(settings.mutate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ path: ['petId'], value: 'redspark-kitsune' }),
    ]))

    await fiber.dispose()
  })
})
