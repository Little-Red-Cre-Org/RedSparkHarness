import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PetSettings } from '../src/pet-settings.ts'
import { PetRuntime, type PetActivity } from '../src/client/runtime.ts'

const SID = 'pet-session' as SessionId

describe('PetRuntime', () => {
  it('keeps a replacement report when an older identical report is disposed', () => {
    const runtime = new PetRuntime(new Context(), stubSettingsScope<PetSettings>().scope)
    const old = runtime.setActivity(SID, 'tool', 'working')
    const current = runtime.setActivity(SID, 'tool', 'working')
    old()
    expect(runtime.state.getSnapshot().activities.get(SID)).toBe('working')
    current()
    expect(runtime.state.getSnapshot().activities.get(SID)).toBeUndefined()
  })
  it('registers independent characters and removes only the owning entry', () => {
    const runtime = new PetRuntime(new Context(), stubSettingsScope<PetSettings>().scope)
    const dispose = runtime.register({ id: 'custom', name: 'Custom', variants: [{ id: 'base', atlasUrl: '/custom.png' }] })
    expect(runtime.state.getSnapshot().pets.map(pet => pet.id)).toEqual(['custom'])
    expect(() => { runtime.register({ id: 'custom', name: 'Again', variants: [{ id: 'x', atlasUrl: '/x.png' }] }) }).toThrow('already registered')
    expect(() => { runtime.register({ id: 'empty', name: 'Empty', variants: [] }) }).toThrow('has no variants')
    dispose()
    dispose()
    expect(runtime.state.getSnapshot().pets).toEqual([])
  })

  it('publishes the latest activity and restores the preceding source after disposal', () => {
    const runtime = new PetRuntime(new Context(), stubSettingsScope<PetSettings>().scope)
    const disposeThinking = runtime.setActivity(SID, 'agent', 'thinking')
    const disposeCoding = runtime.setActivity(SID, 'coding-tool', 'coding')
    expect(runtime.state.getSnapshot().activities.get(SID)).toBe('coding')
    disposeCoding()
    expect(runtime.state.getSnapshot().activities.get(SID)).toBe('thinking')
    disposeThinking()
    expect(runtime.state.getSnapshot().activities.get(SID)).toBeUndefined()
  })

  it('isolates reports with identical source names in separate sessions', () => {
    const runtime = new PetRuntime(new Context(), stubSettingsScope<PetSettings>().scope)
    const other = 'other-session' as SessionId
    const dispose = runtime.setActivity(SID, 'tool', 'coding')
    runtime.setActivity(other, 'tool', 'working')
    expect(runtime.state.getSnapshot().activities.get(SID)).toBe('coding')
    expect(runtime.state.getSnapshot().activities.get(other)).toBe('working')
    dispose()
    expect(runtime.state.getSnapshot().activities.has(SID)).toBe(false)
    expect(runtime.state.getSnapshot().activities.get(other)).toBe('working')
  })

  it('does not project an empty internal activity report map', () => {
    const runtime = new PetRuntime(new Context(), stubSettingsScope<PetSettings>().scope)
    const internal = runtime as unknown as {
      activities: Map<SessionId, Map<string, { activity: PetActivity }>>
      publish: () => void
    }
    internal.activities.set(SID, new Map())
    internal.publish()
    expect(runtime.state.getSnapshot().activities.has(SID)).toBe(false)
  })

  it('routes preference writes through the settings scope', () => {
    const host = stubSettingsScope<PetSettings>()
    const runtime = new PetRuntime(new Context(), host.scope)
    runtime.setPreference('variant', 'chibi')
    expect(host.set).toHaveBeenCalledWith('variant', 'chibi')
  })

  it('retains an optimistic variant while a following character selection is queued', () => {
    const host = stubSettingsScope<PetSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: { enabled: true, desktopEnabled: false, petId: 'first', variant: 'normal', customPets: [] },
    })
    const runtime = new PetRuntime(new Context(), host.scope)
    runtime.register({ id: 'first', name: 'First', variants: [{ id: 'normal', atlasUrl: '/first.png' }, { id: 'chibi', atlasUrl: '/first-chibi.png' }] })
    runtime.register({ id: 'second', name: 'Second', variants: [{ id: 'normal', atlasUrl: '/second.png' }, { id: 'chibi', atlasUrl: '/second-chibi.png' }] })

    runtime.setPreference('variant', 'chibi')
    runtime.selectPet('second')

    expect(runtime.state.getSnapshot()).toMatchObject({ petId: 'second', variant: 'chibi' })
    expect(host.mutate).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ path: ['petId'], value: 'second' }),
      expect.objectContaining({ path: ['variant'], value: 'chibi' }),
    ]))
  })

  it('selects a registered character with a supported variant', () => {
    const host = stubSettingsScope<PetSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: { enabled: true, desktopEnabled: false, petId: 'redspark-kitsune', variant: 'chibi', customPets: [] },
    })
    const runtime = new PetRuntime(new Context(), host.scope)
    runtime.register({ id: 'redspark-kitsune', name: 'Kitsune', variants: [{ id: 'normal', atlasUrl: '/normal.png' }, { id: 'chibi', atlasUrl: '/chibi.png' }] })
    runtime.register({ id: 'plugin-pet', name: 'Plugin pet', variants: [{ id: 'focused', atlasUrl: '/focused.png' }] })

    runtime.selectPet('redspark-kitsune')
    expect(host.mutate).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ path: ['variant'], value: 'chibi' }),
    ]))
    runtime.selectPet('plugin-pet')
    expect(host.mutate).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ path: ['petId'], value: 'plugin-pet' }),
      expect.objectContaining({ path: ['variant'], value: 'focused' }),
    ]))
    expect(() => { runtime.selectPet('missing') }).toThrow('is not registered')
  })

  it('lets the settings scope serialize rapid character selections', () => {
    const host = stubSettingsScope<PetSettings>()
    const runtime = new PetRuntime(new Context(), host.scope)
    runtime.register({ id: 'first', name: 'First', variants: [{ id: 'normal', atlasUrl: '/first.png' }] })
    runtime.register({ id: 'second', name: 'Second', variants: [{ id: 'normal', atlasUrl: '/second.png' }] })

    runtime.selectPet('first')
    runtime.selectPet('second')

    expect(host.mutate).toHaveBeenNthCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ path: ['petId'], value: 'first' }),
    ]))
    expect(host.mutate).toHaveBeenNthCalledWith(2, expect.arrayContaining([
      expect.objectContaining({ path: ['petId'], value: 'second' }),
    ]))
  })

  it('keeps remote-browser choices and imports process-local while the scope is memory-only', async () => {
    const host = stubSettingsScope<PetSettings>()
    host.publish({ mode: 'memory', status: 'unavailable', value: undefined, writable: false })
    const runtime = new PetRuntime(new Context(), host.scope)
    runtime.register({ id: 'redspark-kitsune', name: 'Kitsune', variants: [{ id: 'normal', atlasUrl: '/brand/kitsune-sprites.png' }, { id: 'chibi', atlasUrl: '/brand/kitsune-chibi-sprites.png' }] })

    runtime.setPreference('enabled', false)
    runtime.setPreference('variant', 'chibi')
    runtime.register({ id: 'plugin-pet', name: 'Plugin pet', variants: [{ id: 'focused', atlasUrl: '/focused.png' }] })
    runtime.selectPet('plugin-pet')
    expect(runtime.state.getSnapshot()).toMatchObject({ petId: 'plugin-pet', variant: 'focused' })
    await runtime.importPet('Remote pet', 'data:image/png;base64,aGVsbG8=')

    const imported = runtime.state.getSnapshot().customPetIds[0]
    expect(runtime.state.getSnapshot()).toMatchObject({ enabled: false, petId: imported, variant: 'normal' })
    expect(imported).toMatch(/^imported-/)
    expect(host.set).not.toHaveBeenCalled()
    expect(host.mutate).not.toHaveBeenCalled()

    await runtime.removePet(imported!)
    expect(runtime.state.getSnapshot()).toMatchObject({ petId: 'redspark-kitsune', variant: 'normal', customPetIds: [] })
    await runtime.removePet('not-selected')
  })

  it('enforces the imported-character cap in a memory-only browser scope', async () => {
    const host = stubSettingsScope<PetSettings>()
    host.publish({
      mode: 'memory', status: 'unavailable', writable: false,
      value: {
        enabled: true, desktopEnabled: false, petId: 'redspark-kitsune', variant: 'normal',
        customPets: Array.from({ length: 20 }, (_value, index) => ({
          id: `imported-${index}`, name: `Pet ${index}`, atlasUrl: 'data:image/png;base64,aGVsbG8=',
        })),
      },
    })
    const runtime = new PetRuntime(new Context(), host.scope)

    await expect(runtime.importPet('Overflow', 'data:image/png;base64,aGVsbG8=')).rejects.toThrow('maximum of 20')
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('adopts Host acceptances, notifies subscribers, and persists imported selections', async () => {
    const host = stubSettingsScope<PetSettings>()
    const initial: PetSettings = { enabled: true, desktopEnabled: false, petId: 'redspark-kitsune', variant: 'normal', customPets: [] }
    host.publish({ status: 'ready', writable: true, revision: 1, value: initial })
    host.mutate.mockImplementation((operations: readonly { path: readonly [keyof PetSettings]; value: unknown }[]) => {
      const current = host.scope.getSnapshot().value
      if (current === undefined) throw new Error('missing acceptance state')
      const next = { ...current, customPets: current.customPets.map(pet => ({ ...pet })) }
      for (const operation of operations) Object.assign(next, { [operation.path[0]]: operation.value })
      host.publish({ value: next, revision: (host.scope.getSnapshot().revision ?? 0) + 1 })
    })
    const runtime = new PetRuntime(new Context(), host.scope)
    const changed = vi.fn()
    const unsubscribe = runtime.state.subscribe(changed)

    await runtime.importPet('Saved', 'data:image/png;base64,aGVsbG8=')
    const imported = runtime.state.getSnapshot().customPetIds[0]
    expect(runtime.state.getSnapshot().petId).toBe(imported)
    await runtime.removePet(imported!)
    expect(runtime.state.getSnapshot()).toMatchObject({ petId: 'redspark-kitsune', customPetIds: [] })
    expect(changed).toHaveBeenCalled()
    unsubscribe()
    const before = changed.mock.calls.length
    runtime.setActivity(SID, 'work', 'working')
    expect(changed).toHaveBeenCalledTimes(before)
  })

  it('rejects a Host removal when the provider leaves the imported character in place', async () => {
    const host = stubSettingsScope<PetSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: { enabled: true, desktopEnabled: false, petId: 'imported-stale', variant: 'normal', customPets: [
        { id: 'imported-stale', name: 'Stale', atlasUrl: 'data:image/png;base64,aGVsbG8=' },
      ] },
    })
    const runtime = new PetRuntime(new Context(), host.scope)
    await expect(runtime.removePet('imported-stale')).rejects.toThrow('Pet removal was not saved')
  })
})
