/** Startup controls for shell documents; application documents receive only the carrier marker. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopStartupApi } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import { installTitleBar } from './title-bar.ts'

installTitleBar()

let ideSelection: (() => unknown) | undefined

const startup: DshDesktopStartupApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as ReturnType<DshDesktopStartupApi['locale']>,
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopStartupApi['backend']['status']>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  disablePlugins: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.applicationRestart) as Promise<void>,
  resetConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationReset) as Promise<void>,
}

contextBridge.exposeInMainWorld('dshDesktop', location.protocol === 'dsh-app:' && location.hostname === 'shell'
  ? startup : location.protocol === 'dsh-app:' && location.hostname === 'app'
    ? { protocolVersion: 1, notifyTask: (value: unknown) => ipcRenderer.invoke(DESKTOP_IPC.taskNotification, value),
      ide: {
        current: () => ideSelection?.(),
        provideSelection: (listener: () => unknown) => {
          ideSelection = listener
          return () => { if (ideSelection === listener) ideSelection = undefined }
        },
        open: (value: unknown) => ipcRenderer.invoke(DESKTOP_IPC.ideOpen, value),
        subscribe: (listener: (value: unknown) => Promise<void>) => {
          const restore = (_event: Electron.IpcRendererEvent, value: unknown): void => {
            void Promise.resolve().then(() => listener(value)).then(
              () => ipcRenderer.invoke(DESKTOP_IPC.ideRestored, { ok: true }),
              (error: unknown) => ipcRenderer.invoke(DESKTOP_IPC.ideRestored,
                { ok: false, message: error instanceof Error ? error.message : String(error) }),
            ).catch(console.error)
          }
          ipcRenderer.on(DESKTOP_IPC.ideRestore, restore)
          return () => { ipcRenderer.off(DESKTOP_IPC.ideRestore, restore) }
        },
      },
      pet: { update: (value: unknown) => ipcRenderer.invoke(DESKTOP_IPC.petUpdate, value) } }
    : { protocolVersion: 1 })
