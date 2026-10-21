/** Read-only presentation subscription for the shell-owned pet renderer. */
import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import type { DesktopPetPresentation } from './pet-presentation.ts'

contextBridge.exposeInMainWorld('desktopPet', {
  subscribe(listener: (state: DesktopPetPresentation) => void): () => void {
    const handle = (_event: Electron.IpcRendererEvent, state: DesktopPetPresentation): void => { listener(state) }
    ipcRenderer.on(DESKTOP_IPC.petState, handle)
    return () => { ipcRenderer.off(DESKTOP_IPC.petState, handle) }
  },
})
