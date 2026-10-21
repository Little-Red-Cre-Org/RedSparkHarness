import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopPetWindow } from '../src/pet-window.ts'

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const windows: FakeWindow[] = []
  class FakeWindow extends EventEmitter {
    destroyed = false
    finishLoad!: () => void
    readonly loaded = new Promise<void>((resolve) => { this.finishLoad = resolve })
    readonly webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn() })
    readonly hide = vi.fn()
    readonly showInactive = vi.fn()
    constructor(readonly options: Record<string, unknown>) { super(); windows.push(this) }
    loadURL() { return this.loaded }
    isDestroyed() { return this.destroyed }
    close() { this.destroyed = true; this.emit('closed') }
  }
  return { windows, FakeWindow }
})
vi.mock('electron', () => ({
  BrowserWindow: harness.FakeWindow,
  screen: { getPrimaryDisplay: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }) },
}))
afterEach(() => { harness.windows.length = 0 })
const state = { visible: true, atlasUrl: 'dsh-app://app/brand/pet.png', frame: 0, label: 'Idle' }

describe('desktop pet window lifecycle', () => {
  it('creates one transparent window and publishes the latest state after loading', async () => {
    const pet = new DesktopPetWindow('preload.cjs')
    try {
      pet.update(state)
      pet.update({ ...state, frame: 2, label: 'Thinking' })
      expect(harness.windows).toHaveLength(1)
      const window = harness.windows[0]!
      expect(window.options).toMatchObject({ transparent: true, alwaysOnTop: true, frame: false, x: -264 })
      expect(window.webContents.send).not.toHaveBeenCalled()
      window.finishLoad()
      await window.loaded
      expect(window.webContents.send).toHaveBeenCalledWith('dsh-desktop:pet-state', { ...state, frame: 2, label: 'Thinking' })
      expect(window.showInactive).toHaveBeenCalledOnce()
      pet.update({ ...state, visible: false })
      expect(window.hide).toHaveBeenCalledOnce()
    } finally { pet.close() }
  })

  it('does not recreate or show a window after disposal during loading', async () => {
    const pet = new DesktopPetWindow('preload.cjs')
    pet.update(state)
    const window = harness.windows[0]!
    pet.close()
    pet.close()
    window.finishLoad()
    await window.loaded
    expect(window.destroyed).toBe(true)
    expect(window.showInactive).not.toHaveBeenCalled()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('does not allocate a window for a disabled preference', () => {
    const pet = new DesktopPetWindow('preload.cjs')
    pet.update({ ...state, visible: false })
    expect(harness.windows).toHaveLength(0)
    pet.close()
  })
})
