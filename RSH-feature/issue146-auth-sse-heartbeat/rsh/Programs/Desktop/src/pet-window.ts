/** Electron provider for the client-owned desktop pet presentation. */
import { BrowserWindow, screen } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import type { DesktopPetPresentation } from './pet-presentation.ts'

/** Own one transparent, draggable window without owning character or Agent policy. */
export class DesktopPetWindow {
  private window: BrowserWindow | undefined
  private presentation: DesktopPetPresentation | undefined
  private ready = false

  /** @param preload - Sandboxed, read-only pet renderer preload path. */
  constructor(private readonly preload: string) {}

  /**
   * Update the displayed frame, creating the window only when visible.
   * @param presentation - Validated plugin presentation.
   */
  update(presentation: DesktopPetPresentation): void {
    this.presentation = presentation
    if (!presentation.visible) {
      this.window?.hide()
      return
    }
    if (this.window === undefined) {
      const area = screen.getPrimaryDisplay().workArea
      const window = new BrowserWindow({
        width: 240, height: 280, x: area.x + area.width - 264, y: area.y + area.height - 304,
        frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
        resizable: false, minimizable: false, maximizable: false, show: false,
        webPreferences: { preload: this.preload, nodeIntegration: false, contextIsolation: true, sandbox: true },
      })
      this.window = window
      this.ready = false
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => { event.preventDefault() })
      window.once('closed', () => {
        if (this.window === window) { this.window = undefined; this.ready = false }
      })
      void window.loadURL('dsh-app://shell/pet.html').then(() => {
        if (this.window !== window || window.isDestroyed()) return
        this.ready = true
        this.publish()
      }).catch((error: unknown) => {
        if (this.window !== window || window.isDestroyed()) return
        this.close()
        console.error('Desktop pet renderer failed to load', error)
      })
    }
    this.publish()
  }

  /** Close the owned window and discard its presentation. */
  close(): void {
    const window = this.window
    this.window = undefined
    this.ready = false
    this.presentation = undefined
    if (window !== undefined && !window.isDestroyed()) window.close()
  }

  private publish(): void {
    if (!this.ready || this.window === undefined || this.presentation === undefined) return
    this.window.webContents.send(DESKTOP_IPC.petState, this.presentation)
    if (this.presentation.visible) this.window.showInactive()
  }
}
