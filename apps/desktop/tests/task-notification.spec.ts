import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const state = vi.hoisted(() => ({ windows: [] as unknown[] }))
vi.mock('electron', () => ({
  app: Object.assign(new EventEmitter(), { getAppPath: () => process.cwd() + '/apps/desktop' }),
  nativeImage: { createFromPath: () => ({ resize: () => ({ toPNG: () => Buffer.from('image') }) }) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
  BrowserWindow: class extends EventEmitter {
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), executeJavaScript: vi.fn(async () => {}) }
    showInactive = vi.fn()
    setBounds = vi.fn()
    removeMenu = vi.fn()
    loadURL = vi.fn(async () => {})
    destroyed = false
    isDestroyed = () => this.destroyed
    close = (): void => { this.destroyed = true; this.emit('closed') }
    destroy = (): void => { this.close() }
    constructor(public options: Record<string, unknown>) { super(); state.windows.push(this) }
  },
}))
type Window = EventEmitter & {
  webContents: { executeJavaScript: ReturnType<typeof vi.fn> }
  setBounds: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  close: () => void
  isDestroyed: () => boolean
}
beforeEach(() => { vi.resetModules(); state.windows.length = 0; vi.useFakeTimers() })
afterEach(async () => { const { app } = await import('electron'); app.emit('before-quit'); app.removeAllListeners(); vi.useRealTimers() })

it('displays simultaneous reminders in one window immediately with independent expiry', async () => {
  const { showTaskNotification } = await import('../src/task-notification.ts')
  expect(() => { showTaskNotification({ title: 3 }) }).toThrow('Invalid')
  showTaskNotification({ id: 'one', title: '<script>bad</script>', body: 'First' })
  showTaskNotification({ id: 'two', title: 'Second', body: 'Arrived before the window loaded' })
  const popup = state.windows[0] as Window
  popup.emit('ready-to-show')
  expect(state.windows).toHaveLength(1)
  expect(popup.showInactive).toHaveBeenCalledOnce()
  expect(popup.setBounds).toHaveBeenLastCalledWith({ x: 1448, y: 548, width: 460, height: 480 })
  const initial = popup.webContents.executeJavaScript.mock.calls.at(-1)![0] as string
  expect(initial).toContain('&lt;script&gt;bad&lt;/script&gt;')
  expect(initial).toContain('Second')
  await vi.advanceTimersByTimeAsync(5000)
  showTaskNotification({ id: 'three', title: 'Third', body: 'No queue' })
  expect(state.windows).toHaveLength(1)
  expect(popup.webContents.executeJavaScript.mock.calls.at(-1)![0]).toContain('Third')
  await vi.advanceTimersByTimeAsync(15000)
  expect(popup.isDestroyed()).toBe(false)
  const remaining = popup.webContents.executeJavaScript.mock.calls.at(-1)![0] as string
  expect(remaining).toContain('Third'); expect(remaining).not.toContain('Second')
  await vi.advanceTimersByTimeAsync(5000)
  expect(popup.isDestroyed()).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('dismisses individual reminders and cancels all timers when the window closes', async () => {
  const { showTaskNotification } = await import('../src/task-notification.ts')
  showTaskNotification({ id: 'one', title: 'First', body: '' })
  const popup = state.windows[0] as Window
  popup.emit('ready-to-show')
  showTaskNotification({ id: 'two', title: 'Second', body: '' })
  showTaskNotification({ dismissId: 'one' })
  expect(popup.isDestroyed()).toBe(false)
  expect(popup.webContents.executeJavaScript.mock.calls.at(-1)![0]).not.toContain('First')
  expect(vi.getTimerCount()).toBe(1)
  popup.close()
  await vi.advanceTimersByTimeAsync(30000)
  expect(state.windows).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
  showTaskNotification({ id: 'next', title: 'After close', body: '' })
  expect(state.windows).toHaveLength(2)
  const next = state.windows[1] as Window
  next.emit('ready-to-show')
  const { app } = await import('electron')
  app.emit('before-quit')
  expect(next.isDestroyed()).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
