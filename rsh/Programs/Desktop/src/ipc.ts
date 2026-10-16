/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import type { DesktopErrorType } from './startup-error.ts'
import type {
  NativeDesktopInstallRequest,
  NativeDesktopListOutcome,
  NativeDesktopMutationOutcome,
  NativeDesktopMutationRequest,
  NativeDesktopPackageMutationRequest,
  NativeDesktopToggleRequest,
  NativeDesktopUpdateRequest,
} from './native-module-management.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  taskNotification: 'dsh-desktop:task-notification',
  petUpdate: 'dsh-desktop:pet-update',
  petState: 'dsh-desktop:pet-state',
  windowMenu: 'dsh-desktop:window-menu',
  windowColors: 'dsh-desktop:window-colors',
  localeGet: 'dsh-desktop:locale-get',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  pluginsToggle: 'dsh-desktop:plugins-toggle',
  pluginsDisableAll: 'dsh-desktop:plugins-disable-all',
  backendStatus: 'dsh-desktop:backend-status',
  backendRetry: 'dsh-desktop:backend-retry',
  applicationRestart: 'dsh-desktop:application-restart',
  configurationReset: 'dsh-desktop:configuration-reset',
  backendState: 'dsh-desktop:backend-state',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdateState =
  | { readonly phase: 'idle' | 'checking' }
  | { readonly phase: 'available' | 'installing' | 'ready'; readonly version: string }
  | { readonly phase: 'error'; readonly version?: string; readonly errorType: DesktopErrorType; readonly logPath?: string }

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
    toggle(name: string, enabled: boolean): Promise<void>
    disableAll(): Promise<void>
    /** Native profile operations use the same authenticated plugin IPC channels. */
    readonly native: NativeDesktopModuleManagementApi
  }
  readonly backend: {
    status(): Promise<DesktopBackendState>
    retry(): Promise<void>
    subscribe(listener: (state: DesktopBackendState) => void): () => void
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}

/** Native profile capability exposed to the shell-owned module-management page. */
export interface NativeDesktopModuleManagementApi {
  /** Reads Native package and installation state under the Desktop profile lock. */
  list(): Promise<NativeDesktopListOutcome>
  /** Installs one exact package version and its explicit Host or Client rows. */
  install(request: NativeDesktopInstallRequest): Promise<NativeDesktopMutationOutcome>
  /** Removes a profile-managed package and every selected row for it. */
  remove(request: NativeDesktopPackageMutationRequest): Promise<NativeDesktopMutationOutcome>
  /** Updates a profile-managed package while preserving every installation row. */
  update(request: NativeDesktopUpdateRequest): Promise<NativeDesktopMutationOutcome>
  /** Enables or disables exactly one persisted target row. */
  toggle(request: NativeDesktopToggleRequest): Promise<NativeDesktopMutationOutcome>
  /** Disables enabled rows outside the backend-computed required-provider closure. */
  disableAll(request: NativeDesktopMutationRequest): Promise<NativeDesktopMutationOutcome>
}

/** Startup-page controls, unavailable to backend-provided application documents. */
export interface DshDesktopStartupApi extends Pick<DshDesktopApi, 'protocolVersion' | 'locale'> {
  readonly backend: Omit<DshDesktopApi['backend'], 'retry'>
  disablePlugins(): Promise<void>
  restart(): Promise<void>
  resetConfiguration(): Promise<void>
}
