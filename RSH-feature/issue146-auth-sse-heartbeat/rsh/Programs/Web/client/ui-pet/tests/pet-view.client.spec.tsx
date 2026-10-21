// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en, zh } from '../src/client/locales.ts'
import { PetSettingsRow, type PetSettingsRowProps } from '../src/client/PetSettingsRow.tsx'
import { derivePetActivity, PetView, type PetViewProps } from '../src/client/PetView.tsx'
import * as importPng from '../src/client/import-png.ts'
import type { PetSnapshot } from '../src/client/runtime.ts'
import type { PetLifecycle } from '../src/client/activity-projection.ts'

const SID = 'pet-test' as SessionId
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'dshDesktop')
})
const snapshot: PetSnapshot = {
  enabled: true,
  desktopEnabled: false,
  petId: 'redspark-kitsune',
  variant: 'normal',
  pets: [{ id: 'redspark-kitsune', name: 'Kitsune', variants: [
    { id: 'normal', atlasUrl: '/brand/kitsune-sprites.png' },
    { id: 'chibi', atlasUrl: '/brand/kitsune-chibi-sprites.png' },
  ] }],
  activities: new Map(),
  customPetIds: [],
  revision: 1,
}

function session(changes: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: SID, queue: [], pendingSubmissions: [], running: false, subagent: null,
    removed: false, openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, lastAgentError: null, promptAttempted: true,
    awaitingFirstTurn: false, ...changes,
  }
}

function viewProps(state: PetSnapshot, value: SessionSnapshot): PetViewProps {
  return {
    placement: 'hero', sessionId: SID,
    usePet: bindSnapshotSelector(createSnapshotStore(state)),
    usePetLifecycle: bindSnapshotSelector(createSnapshotStore(undefined)),
    longRunningAfterMs: 60_000,
    useSession: bindSnapshotSelector(createSnapshotStore(value)),
    useSessionPendingInteraction: bindSnapshotSelector(createSnapshotStore(new Map())),
    t: makeTranslate(en),
  } as unknown as PetViewProps
}

describe('desktop pet presentation', () => {
  it('uses the persisted variant and maps running to the thinking copy', () => {
    const view = render(<PetView {...viewProps(snapshot, session({ running: true }))} />)
    expect(view.getByRole('status').textContent).toBe('Kitsune is thinking…')
    expect(view.getByRole('img').getAttribute('style')).toContain('/brand/kitsune-sprites.png')
  })

  it('uses the RedSpark thinking copy requested for the Chinese presentation', () => {
    const state: PetSnapshot = { ...snapshot, activities: new Map([[SID, 'thinking']]) }
    const props = { ...viewProps(state, session()), t: makeTranslate(zh) }
    const view = render(<PetView {...props} />)
    expect(view.getByRole('status').textContent).toBe('赤绯思考中...')
  })

  it('hides the Electron carrier when the presentation unmounts', () => {
    const update = vi.fn(() => Promise.resolve())
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { pet: { update } } })
    const view = render(<PetView {...viewProps({ ...snapshot, desktopEnabled: true }, session())} />)

    view.unmount()

    expect(update).toHaveBeenLastCalledWith({
      visible: false, atlasUrl: '/brand/kitsune-sprites.png', frame: 0, label: '',
    })
  })

  it('updates native status without hiding the desktop carrier between activities', () => {
    const update = vi.fn(() => Promise.resolve())
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { pet: { update } } })
    const view = render(<PetView {...viewProps({ ...snapshot, desktopEnabled: true }, session())} />)
    update.mockClear()

    view.rerender(<PetView {...viewProps({ ...snapshot, desktopEnabled: true, activities: new Map([[SID, 'thinking']]) }, session())} />)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, frame: 2 }))
  })

  it('reports a carrier failure without leaving its native window visible', async () => {
    const update = vi.fn(() => Promise.reject(new Error('carrier unavailable')))
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { pet: { update } } })
    const view = render(<PetView {...viewProps({ ...snapshot, desktopEnabled: true }, session())} />)

    await waitFor(() => { expect(view.getByRole('status').textContent).toBe('The desktop pet could not update. Toggle desktop display to retry.') })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ visible: true }))
  })

  it('hides when the shared preference is disabled', () => {
    const view = render(<PetView {...viewProps({ ...snapshot, enabled: false }, session())} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('does not let a greeting conceal running or failed work', () => {
    const view = render(<PetView {...viewProps(snapshot, session())} />)
    fireEvent.click(view.getByRole('button', { name: 'Say hello to Kitsune' }))
    view.rerender(<PetView {...viewProps(snapshot, session({ running: true }))} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('thinking')
    view.rerender(<PetView {...viewProps(snapshot, session({ lastAgentError: 'failed' }))} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('error')
  })

  it('clears completion when another session replaces the finished session', () => {
    const view = render(<PetView {...viewProps(snapshot, session({ running: true }))} />)
    view.rerender(<PetView {...viewProps(snapshot, session())} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('complete')
    view.rerender(<PetView {...viewProps(snapshot, session())} sessionId={'other' as SessionId} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('idle')
  })

  it('returns from the completion reaction after its scheduled interval', () => {
    vi.useFakeTimers()
    try {
      const view = render(<PetView {...viewProps(snapshot, session({ running: true }))} />)
      view.rerender(<PetView {...viewProps(snapshot, session())} />)
      expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('complete')
      act(() => { vi.advanceTimersByTime(3200) })
      expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('idle')
    } finally { vi.useRealTimers() }
  })

  it('prioritizes error, approval waiting, and running', () => {
    expect(derivePetActivity(session({ running: true, lastAgentError: 'failed' }), true)).toBe('error')
    expect(derivePetActivity(session({ running: true }), true)).toBe('waiting')
    expect(derivePetActivity(session({ running: true }), false)).toBe('thinking')
  })

  it('derives every standard Session fallback activity', () => {
    expect(derivePetActivity(session({ promptError: { op: 'send', error: { code: 'failed', message: 'failed' } as never } }), false)).toBe('error')
    expect(derivePetActivity(session({ openState: 'error' }), false)).toBe('error')
    expect(derivePetActivity(session({ awaitingFirstTurn: true }), false)).toBe('thinking')
    expect(derivePetActivity(undefined, false)).toBe('idle')
  })

  it('keeps a specific coding report while the session is running', () => {
    const state: PetSnapshot = { ...snapshot, activities: new Map([[SID, 'coding']]) }
    const view = render(<PetView {...viewProps(state, session({ running: true }))} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('coding')
    view.rerender(<PetView {...viewProps(state, session({ lastAgentError: 'failed' }))} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('error')
  })

  it('uses projected activity and each desktop sprite frame without requiring a Session id', async () => {
    const update = vi.fn(() => Promise.resolve())
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { pet: { update } } })
    const sleeping: PetSnapshot = { ...snapshot, desktopEnabled: true, activities: new Map([[SID, 'sleeping']]) }
    const view = render(<PetView {...viewProps(sleeping, session())} />)
    await act(async () => {})
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ visible: true, frame: 1 }))
    const complete: PetSnapshot = { ...sleeping, activities: new Map([[SID, 'complete']]) }
    view.rerender(<PetView {...viewProps(complete, session())} />)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ frame: 3 }))
    const working: PetSnapshot = { ...sleeping, activities: new Map([[SID, 'working']]) }
    view.rerender(<PetView {...viewProps(working, session())} />)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ frame: 2 }))

    const projected = {
      ...viewProps({ ...snapshot, desktopEnabled: true }, session({ running: true })), sessionId: undefined,
      usePetLifecycle: bindSnapshotSelector(createSnapshotStore({ seq: 1, startedAt: 0, active: true, activity: 'working' })),
    } as unknown as PetViewProps
    view.rerender(<PetView {...projected} />)
    expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('working')
  })

  it('falls back to the first registered variant and renders user-provided character names', () => {
    const custom: PetSnapshot = {
      ...snapshot, petId: 'missing', variant: 'missing', pets: [{ id: 'custom', name: 'Imported', variants: [{ id: 'normal', atlasUrl: 'data:image/png;base64,aGVsbG8=' }] }],
    }
    const view = render(<PetView {...viewProps(custom, session())} />)
    expect(view.getByRole('img').getAttribute('aria-label')).toBe('Imported')
    expect(view.getByRole('status').textContent).toContain('Imported')
  })

  it('handles an absent Session and an unavailable selected character without producing a native atlas', () => {
    const update = vi.fn(() => Promise.resolve())
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { pet: { update } } })
    const props = {
      ...viewProps({ ...snapshot, desktopEnabled: true, pets: [] }, undefined as unknown as SessionSnapshot), sessionId: undefined,
    } as unknown as PetViewProps
    const view = render(<PetView {...props} />)
    expect(view.container.innerHTML).toBe('')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ atlasUrl: '/brand/kitsune-sprites.png' }))
  })

  it('does not set an error after a stale carrier request rejects during unmount', async () => {
    const rejections: ((reason: unknown) => void)[] = []
    const update = vi.fn(() => new Promise<void>((_resolve, reject) => { rejections.push(reject) }))
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { pet: { update } } })
    const view = render(<PetView {...viewProps({ ...snapshot, desktopEnabled: true }, session())} />)
    view.unmount()
    rejections[0]?.(new Error('stale carrier request'))
    rejections[1]?.(new Error('carrier already closed'))
    await act(async () => {})
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  })

  it('writes the same variant preference used by hero and floating views', () => {
    const setVariant = vi.fn()
    const props = {
      usePet: bindSnapshotSelector(createSnapshotStore(snapshot)),
      setEnabled: vi.fn(), setPet: vi.fn(), setVariant, t: makeTranslate(en),
    } as unknown as PetSettingsRowProps
    const view = render(<PetSettingsRow {...props} />)
    fireEvent.click(view.getByRole('button', { name: 'Chibi' }))
    expect(setVariant).toHaveBeenCalledWith('chibi')
  })

  it('marks the effective fallback variant and distinguishes third-party variant ids', () => {
    const thirdParty: PetSnapshot = {
      ...snapshot,
      petId: 'plugin-pet',
      variant: 'chibi',
      pets: [{ id: 'plugin-pet', name: 'Plugin pet', variants: [
        { id: 'focused', atlasUrl: '/focused.png' }, { id: 'sleeping', atlasUrl: '/sleeping.png' },
      ] }],
    }
    const props = {
      usePet: bindSnapshotSelector(createSnapshotStore(thirdParty)),
      setEnabled: vi.fn(), setPet: vi.fn(), setVariant: vi.fn(), t: makeTranslate(en),
    } as unknown as PetSettingsRowProps
    const view = render(<PetSettingsRow {...props} />)
    expect(view.getByRole('button', { name: 'focused' }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByRole('button', { name: 'sleeping' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('updates every personalization control and removes the selected import', async () => {
    const setEnabled = vi.fn()
    const setDesktopEnabled = vi.fn()
    const setPet = vi.fn()
    const setVariant = vi.fn()
    const removePet = vi.fn(async () => {})
    const imported: PetSnapshot = {
      ...snapshot, desktopEnabled: true, petId: 'imported-a', variant: 'normal', customPetIds: ['imported-a'],
      pets: [...snapshot.pets, { id: 'imported-a', name: 'Imported', variants: [{ id: 'normal', atlasUrl: 'data:image/png;base64,aGVsbG8=' }] }],
    }
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { pet: { update: vi.fn() } } })
    const props = {
      usePet: bindSnapshotSelector(createSnapshotStore(imported)), setEnabled, setDesktopEnabled, setPet, setVariant,
      importPet: vi.fn(async () => {}), removePet, t: makeTranslate(en),
    } as unknown as PetSettingsRowProps
    const view = render(<PetSettingsRow {...props} />)

    fireEvent.click(view.getByRole('switch', { name: 'Show desktop pet' }))
    fireEvent.click(view.getByRole('switch', { name: 'Float above desktop windows' }))
    fireEvent.click(view.getByRole('button', { name: 'Kitsune' }))
    fireEvent.click(view.getByRole('button', { name: 'Normal' }))
    fireEvent.click(view.getByRole('button', { name: 'Remove selected custom pet' }))
    await waitFor(() => { expect(removePet).toHaveBeenCalledWith('imported-a') })
    expect(setEnabled).toHaveBeenCalledWith(false)
    expect(setDesktopEnabled).toHaveBeenCalledWith(false)
    expect(setPet).toHaveBeenCalledWith('redspark-kitsune')
    expect(setVariant).toHaveBeenCalledWith('normal')
  })

  it('shows removal errors and ignores an empty file selection', async () => {
    const props = {
      usePet: bindSnapshotSelector(createSnapshotStore({
        ...snapshot, petId: 'imported-a', customPetIds: ['imported-a'],
        pets: [...snapshot.pets, { id: 'imported-a', name: 'Imported', variants: [{ id: 'normal', atlasUrl: 'data:image/png;base64,aGVsbG8=' }] }],
      })), setEnabled: vi.fn(), setDesktopEnabled: vi.fn(), setPet: vi.fn(), setVariant: vi.fn(),
      importPet: vi.fn(async () => {}), removePet: vi.fn(async () => { throw new Error('refused') }), t: makeTranslate(en),
    } as unknown as PetSettingsRowProps
    const view = render(<PetSettingsRow {...props} />)
    fireEvent.change(view.getByLabelText('Import pet PNG'), { target: { files: [] } })
    fireEvent.click(view.getByRole('button', { name: 'Remove selected custom pet' }))
    await waitFor(() => { expect(view.getByRole('alert')).toBeTruthy() })
  })

  it('imports a selected PNG and reports a conversion failure', async () => {
    const importPet = vi.fn(async () => {})
    const props = {
      usePet: bindSnapshotSelector(createSnapshotStore(snapshot)), setEnabled: vi.fn(), setDesktopEnabled: vi.fn(),
      setPet: vi.fn(), setVariant: vi.fn(), importPet, removePet: vi.fn(async () => {}), t: makeTranslate(en),
    } as unknown as PetSettingsRowProps
    const convert = vi.spyOn(importPng, 'importPetPng').mockResolvedValue('data:image/png;base64,aGVsbG8=')
    const view = render(<PetSettingsRow {...props} />)
    const input = view.getByLabelText('Import pet PNG')

    fireEvent.change(input, { target: { files: [new File(['pet'], '  Imported Pet.png ')] } })
    await waitFor(() => { expect(importPet).toHaveBeenCalledWith('Imported Pet', 'data:image/png;base64,aGVsbG8=') })
    convert.mockRejectedValueOnce(new Error('bad image'))
    fireEvent.change(input, { target: { files: [new File(['pet'], '.png')] } })
    await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Import or save failed. Check the PNG format, image size, and settings write permissions.') })
  })

  it('keeps optional character controls absent when the selection cannot resolve', () => {
    const props = {
      usePet: bindSnapshotSelector(createSnapshotStore({ ...snapshot, pets: [], enabled: false })),
      setEnabled: vi.fn(), setDesktopEnabled: vi.fn(), setPet: vi.fn(), setVariant: vi.fn(),
      importPet: vi.fn(async () => {}), removePet: vi.fn(async () => {}), t: makeTranslate(en),
    } as unknown as PetSettingsRowProps
    const view = render(<PetSettingsRow {...props} />)
    expect(view.queryByText('Character')).toBeNull()
  })

  it('starts with motion enabled, then pauses and resumes it from the companion control', () => {
    const view = render(<PetView {...viewProps(snapshot, session())} />)
    expect(view.getByRole('button', { name: 'Pause motion' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Pause motion' }))
    expect(view.getByRole('button', { name: 'Wake Kitsune' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Wake Kitsune' }))
    expect(view.getByRole('button', { name: 'Pause motion' })).toBeTruthy()
  })

  it('keeps motion opt-in when the system requests reduced motion', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    })
    try {
      const view = render(<PetView {...viewProps(snapshot, session())} />)
      expect(view.getByRole('button', { name: 'Enable motion' })).toBeTruthy()
      fireEvent.click(view.getByRole('button', { name: 'Enable motion' }))
      expect(view.getByRole('button', { name: 'Pause motion' })).toBeTruthy()
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(window, 'matchMedia')
      else Object.defineProperty(window, 'matchMedia', descriptor)
    }
  })

  it('stops motion when the system enables reduced motion after mounting', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    const addEventListener = vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => { listener = callback })
    const removeEventListener = vi.fn()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener, removeEventListener }),
    })
    try {
      const view = render(<PetView {...viewProps(snapshot, session())} />)
      expect(view.getByRole('button', { name: 'Pause motion' })).toBeTruthy()
      act(() => { listener?.({ matches: true } as MediaQueryListEvent) })
      expect(view.getByRole('button', { name: 'Enable motion' })).toBeTruthy()
      view.unmount()
      expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(window, 'matchMedia')
      else Object.defineProperty(window, 'matchMedia', descriptor)
    }
  })

  it('promotes sustained active work to the focused presentation', () => {
    vi.useFakeTimers()
    try {
      const state: PetSnapshot = { ...snapshot, activities: new Map() }
      const props = {
        ...viewProps(state, session({ running: true })), longRunningAfterMs: 100,
        usePetLifecycle: bindSnapshotSelector(createSnapshotStore<PetLifecycle | undefined>({ seq: 1, startedAt: Date.now(), active: true, activity: 'thinking' })),
      }
      const view = render(<PetView {...props} />)
      act(() => { vi.advanceTimersByTime(100) })
      expect(view.container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('focused')
    } finally { vi.useRealTimers() }
  })
})
