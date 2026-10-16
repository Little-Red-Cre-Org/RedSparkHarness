/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import { desktopHostEnvironment } from './host-environment.ts'
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.ts'
import { DESKTOP_IPC, type DesktopUpdateState } from './ipc.ts'
import {
  parseNativeDesktopInstallRequest,
  parseNativeDesktopListRequest,
  parseNativeDesktopMutationRequest,
  parseNativeDesktopPackageRequest,
  parseNativeDesktopToggleRequest,
  parseNativeDesktopUpdateRequest,
} from './native-module-management.ts'
import { formatDesktopMessage, resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { desktopErrorState } from './startup-error.ts'
import type { DesktopErrorState } from './startup-error.ts'
import { startupFailureDocument } from './startup-document.ts'
import { DesktopPetWindow } from './pet-window.ts'
import { parsePetPresentation } from './pet-presentation.ts'
import { showTaskNotification } from './task-notification.ts'

const SCHEME = 'dsh-app'
const DESKTOP_LOG_FILE = 'desktop.log'
let focusPrimaryWindow = (): void => {}
type RecoveryAction = 'restart' | 'plugins' | 'reset'
let profileRecoveryAvailable = (): boolean => false
const emergencyPages = new WeakMap<BrowserWindow, { url: string; busy: boolean }>()
let recoverApplication = (action: RecoveryAction): Promise<void> => {
  if (action !== 'restart') return Promise.reject(new Error('Desktop recovery could not initialize; reinstall the application'))
  app.relaunch()
  app.quit()
  return Promise.resolve()
}

async function showEmergencyDocument(window: BrowserWindow, failure: DesktopErrorState): Promise<void> {
  const document = startupFailureDocument(resolveDesktopLocale(app.getLocale()), {
    ...failure, logPath: join(app.getPath('logs'), DESKTOP_LOG_FILE),
  }, profileRecoveryAvailable())
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(document)}`
  emergencyPages.set(window, { url, busy: false })
  await window.loadURL(url)
}

function logDesktopError(label: string, error: unknown): void {
  console.error(label, error)
  try {
    const logs = app.getPath('logs')
    mkdirSync(logs, { recursive: true })
    appendFileSync(join(logs, DESKTOP_LOG_FILE),
      `${new Date().toISOString()} ${label}\n${inspect(error, { depth: null })}\n\n`)
  } catch (writeError) {
    console.error('Desktop log write failed', writeError)
  }
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}])

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

interface RuntimeResources {
  readonly node: string
  readonly pnpm: string
  readonly dsh: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = (development ? process.env.DSH_DESKTOP_NODE_BINARY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const dsh = (development ? process.env.DSH_DESKTOP_DSH_DIR : undefined) ?? join(process.resourcesPath, 'dsh')
  return { node, pnpm, dsh }
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

function createWindow(preload: string, show = false): BrowserWindow {
  const window = new BrowserWindow({
    icon: join(app.getAppPath(), 'renderer', 'redspark.png'),
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#fff8f8', symbolColor: '#30232a', height: 40 },
      autoHideMenuBar: true,
    } : {}),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    const source = URL.parse(window.webContents.getURL())
    const target = URL.parse(url)
    if (source?.protocol === `${SCHEME}:` && source.hostname === 'app'
      && target !== null && (target.protocol === 'https:' || target.protocol === 'http:')
      && target.username === '' && target.password === '') {
      void shell.openExternal(target.href).catch(() => {
        // Opener errors can contain the OAuth URL; expose only locale-owned recovery advice.
        const messages = resolveDesktopLocale(app.getLocale()).messages
        dialog.showErrorBox(messages.externalLinkFailedTitle, messages.externalLinkFailed)
      })
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).protocol !== `${SCHEME}:`) event.preventDefault()
    const page = emergencyPages.get(window)
    if (page === undefined || page.busy || window.webContents.getURL() !== page.url) return
    const action = new URL(url)
    if (action.protocol !== 'dsh-recovery:' || !['restart', 'plugins', 'reset'].includes(action.hostname)) return
    if (action.hostname !== 'restart' && !profileRecoveryAvailable()) return
    page.busy = true
    void recoverApplication(action.hostname as RecoveryAction).catch(async (error: unknown) => {
      logDesktopError('Desktop recovery failed', error)
      if (!window.isDestroyed()) await showEmergencyDocument(window, desktopErrorState(error))
    }).catch((error: unknown) => { console.error(error) }).finally(() => { page.busy = false })
  })
  return window
}

function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}

function isNativeDesktopPayload(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.hasOwn(value, 'runtime')
}

async function serveShellAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const root = resolve(app.getAppPath(), 'renderer')
  const url = new URL(request.url)
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  const target = resolve(normalize(join(root, pathname)))
  if (target !== root && !target.startsWith(root + sep)) return new Response(null, { status: 403 })
  try {
    const body = request.method === 'HEAD' ? null : await readFile(target)
    return new Response(body, { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

async function main(): Promise<void> {
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  const development = app.isPackaged ? undefined : join(app.getAppPath(), '.desktop-build', 'development', 'project')
  const activeProject = development ?? paths.profile
  const manager = new DesktopProjectManager(paths, resources)
  profileRecoveryAvailable = () => development === undefined && manager.canRecoverProfile()
  let pageError: Extract<DesktopBackendState, { phase: 'error' }> | undefined
  let quitting = false
  let startup: Promise<void> | undefined
  let nativeMutationPromise: Promise<unknown> | undefined
  let quitReady = false
  let ordinaryQuitRequested = false
  let mainWindow: BrowserWindow | undefined
  let pluginWindow: BrowserWindow | undefined
  let shellInstallerOwnsQuit = false
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  const logPath = join(app.getPath('logs'), DESKTOP_LOG_FILE)
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const managementPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))
  const desktopPet = new DesktopPetWindow(fileURLToPath(new URL('./preload-pet.cjs', import.meta.url)))
  const startupUrl = `${SCHEME}://shell/startup.html`
  const applicationUrl = `${SCHEME}://app/index.html`
  let navigation: { window: BrowserWindow; url: string; promise: Promise<void> } | undefined
  let emergencyDocument = false
  let petUpdatesAllowed = false

  const showEmergencyError = async (error: unknown): Promise<void> => {
    if (quitting || emergencyDocument) return
    emergencyDocument = true
    petUpdatesAllowed = false
    desktopPet.close()
    logDesktopError('Desktop emergency startup failed', error)
    const failure = desktopErrorState(error)
    pageError = failure
    if (mainWindow !== undefined) await showEmergencyDocument(mainWindow, failure)
  }

  const navigateMain = (url: string): Promise<void> => {
    const window = mainWindow
    if (quitting || emergencyDocument || window === undefined || window.isDestroyed()) return Promise.resolve()
    if (navigation?.window === window && navigation.url === url) return navigation.promise
    petUpdatesAllowed = false
    const applicationDocument = new URL(url).hostname === 'app'
    if (!applicationDocument) desktopPet.close()
    const next = { window, url, promise: Promise.resolve() }
    next.promise = window.loadURL(url).then(() => {
      if (navigation === next) petUpdatesAllowed = applicationDocument
    }).catch((error: unknown) => {
      if (quitting || window.isDestroyed() || navigation !== next) return
      navigation = undefined
      throw error
    })
    navigation = next
    return next.promise
  }
  const backendState = (): DesktopBackendState => {
    const state = pageError ?? backend.state
    return state.phase === 'error' ? { ...state, logPath, profileRecovery: profileRecoveryAvailable() } : state
  }
  const publishBackend = (state: DesktopBackendState): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.backendState, state)
    }
  }
  const backend = new DesktopBackendController((onFailure) => {
    if (development === undefined) manager.assertProfileRuntime(activeProject)
    const hostInspectPort = developmentHostInspectPort(development !== undefined)
    const host = new DesktopHostProcess(resources.node, development ?? resources.dsh, activeProject,
      hostInspectPort, desktopHostEnvironment(app.isPackaged && process.platform === 'win32'
        ? join(process.resourcesPath, 'runtime', 'bash', 'usr', 'bin') : undefined, process.env), onFailure, logDesktopError)
    return {
      start: () => host.start(),
      stop: () => host.stop(),
      fetch: (request: Request) => host.fetch(request),
    }
  }, (state) => {
    if (state.phase === 'starting' && !emergencyDocument) pageError = undefined
    publishBackend(backendState())
    if (state.phase === 'error') void navigateMain(startupUrl).catch((error: unknown) => { console.error(error) })
  }, logDesktopError)

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
    }
    return state
  }

  const hooks: DesktopProjectHooks = {
    beforeChange: () => backend.stop(),
    afterChange: async () => {
      if (quitting || shellInstallerOwnsQuit) throw new Error('desktop backend shutdown has started')
      await backend.start(async () => {})
    },
  }

  recoverApplication = async (action): Promise<void> => {
    await startup?.catch(() => undefined)
    if (action === 'plugins' && !manager.supportsLegacyPluginManagement()) throw new Error(messages.nativePluginManagementUnavailable)
    await backend.stop()
    if (action === 'restart') {
      app.relaunch()
      app.quit()
      return
    }
    if (!profileRecoveryAvailable()) throw new Error(messages.startupReinstallAdvice)
    if (action === 'reset') await manager.resetConfiguration(hooks)
    else await manager.mutate({ type: 'plugins-disable-all' }, hooks)
    emergencyDocument = false
    pageError = undefined
    navigation = undefined
    await navigateMain(applicationUrl)
  }

  const showStartupError = async (error: unknown): Promise<void> => {
    if (quitting) return
    logDesktopError('Desktop startup failed', error)
    pageError = desktopErrorState(error)
    try { await navigateMain(startupUrl) }
    catch (navigationError) {
      await showEmergencyError(new AggregateError([error, navigationError], messages.startupFailed))
    }
    publishBackend(backendState())
  }
  const reconcileBackend = (): Promise<void> => {
    startup ??= (async () => {
      pageError = undefined
      await navigateMain(startupUrl)
      await backend.start(async () => {
        if (development === undefined) {
          await manager.applyRelease()
        }
      })
      if (backend.host !== undefined) await navigateMain(applicationUrl)
    })().catch(async (error: unknown) => {
      await showStartupError(error)
      throw error
    }).finally(() => { startup = undefined })
    return startup
  }

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      shellInstallerOwnsQuit = true
      try {
        await backend.stop()
        await nativeMutationPromise?.catch(() => undefined)
        quitReady = true
      } catch (error) {
        shellInstallerOwnsQuit = false
        throw error
      }
    },
    async () => {
      shellInstallerOwnsQuit = false
      quitReady = false
      if (ordinaryQuitRequested) {
        quitting = true
        desktopPet.close()
        try {
          try { await backend.close() }
          finally { await nativeMutationPromise?.catch(() => undefined) }
        }
        catch (error) { console.error(error) }
        quitReady = true
        app.quit()
        return
      }
      if (startup !== undefined) {
        try { await startup }
        catch { /* reconcileBackend retries the failed or cancelled startup below. */ }
      }
      try { await reconcileBackend() }
      catch { /* reconcileBackend already showed a Host startup failure. */ }
    },
  )

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (['app', 'shell'].includes(url.hostname) && ['/sph-title-bar.css', '/redspark.svg'].includes(url.pathname)) return serveShellAsset(request)
    if (url.hostname === 'shell') return serveShellAsset(request).then((response) => {
      if (response.status >= 400 && ['/startup.html', '/startup.js', '/startup.css'].includes(url.pathname)) {
        void showEmergencyError(new Error(`Desktop recovery resource could not be loaded: ${url.pathname} (HTTP ${response.status})`))
          .catch((error: unknown) => { console.error(error) })
      }
      return response
    })
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    const active = backend.host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  const mutate = async (event: IpcMainInvokeEvent, mutation: Parameters<DesktopProjectManager['mutate']>[0]): Promise<void> => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) {
      throw new Error('dsh desktop: plugin package changes require a packaged application')
    }
    await startup?.catch(() => undefined)
    if (!manager.supportsLegacyPluginManagement()) throw new Error(messages.nativePluginManagementUnavailable)
    pageError = undefined
    await navigateMain(startupUrl)
    try {
      await manager.mutate(mutation, hooks)
      await navigateMain(applicationUrl)
    } catch (error) {
      try { await showStartupError(error) }
      catch (failure) { console.error(failure) }
      throw new Error(messages.startupFailed)
    }
  }
  const nativeList = async (event: IpcMainInvokeEvent, payload: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) return manager.refuseNativeList('wrong-profile', backendState())
    try { parseNativeDesktopListRequest(payload) }
    catch { return manager.refuseNativeList('invalid-request', backendState()) }
    await startup?.catch(() => undefined)
    if (!manager.supportsNativeModuleManagement()) return manager.refuseNativeList('wrong-profile', backendState())
    return manager.listNativeModules(backendState)
  }
  const nativeMutation = (
    event: IpcMainInvokeEvent,
    parse: () => Parameters<DesktopProjectManager['mutateNativeModules']>[0],
  ): Promise<unknown> => {
    assertDesktopSender(event, ['shell'])
    if (quitting || shellInstallerOwnsQuit) return Promise.resolve(manager.refuseNativeMutation('busy', backendState()))
    if (development !== undefined) {
      return Promise.resolve(manager.refuseNativeMutation('wrong-profile', backendState()))
    }
    let mutation: Parameters<DesktopProjectManager['mutateNativeModules']>[0]
    try { mutation = parse() }
    catch { return Promise.resolve(manager.refuseNativeMutation('invalid-request', backendState())) }
    if (nativeMutationPromise !== undefined) {
      return Promise.resolve(manager.refuseNativeMutation('busy', backendState()))
    }
    const operation = (async () => {
      await startup?.catch(() => undefined)
      // A quit or update can begin while the initial backend startup is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (quitting || shellInstallerOwnsQuit) return manager.refuseNativeMutation('busy', backendState())
      if (!manager.supportsNativeModuleManagement()) return manager.refuseNativeMutation('wrong-profile', backendState())
      const nativeHooks: DesktopProjectHooks = {
        beforeChange: async () => {
          await navigateMain(startupUrl)
          await hooks.beforeChange()
        },
        afterChange: () => hooks.afterChange(),
      }
      const outcome = await manager.mutateNativeModules(mutation, nativeHooks, backendState)
      // The updater can claim quit while this manager promise is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (outcome.status === 'recovery-required' && backendState().phase !== 'error' && !shellInstallerOwnsQuit) {
        await showStartupError(new Error(messages.nativeRecoveryError))
      } else if (outcome.status === 'applied' || ('error' in outcome && outcome.error.backend.phase === 'ready')) {
        try { await navigateMain(applicationUrl) }
        catch (error) { await showStartupError(error) }
      }
      return outcome
    })()
    nativeMutationPromise = operation
    const clearMutation = (): void => {
      if (nativeMutationPromise === operation) nativeMutationPromise = undefined
    }
    void operation.then(clearMutation, clearMutation)
    return operation
  }
  ipcMain.handle(DESKTOP_IPC.localeGet, (event) => {
    assertDesktopSender(event, ['shell'])
    return locale
  })
  ipcMain.handle(DESKTOP_IPC.petUpdate, (event, value: unknown) => {
    assertDesktopSender(event, ['app'])
    if (!petUpdatesAllowed || event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Desktop pet updates require the primary application frame')
    }
    desktopPet.update(parsePetPresentation(value))
  })
  ipcMain.handle(DESKTOP_IPC.taskNotification, (event, value: unknown) => {
    assertDesktopSender(event, ['app'])
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Task notifications require the primary application frame')
    }
    showTaskNotification(value)
  })
  ipcMain.handle(DESKTOP_IPC.windowMenu, (event) => {
    assertDesktopSender(event, ['app', 'shell'])
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window !== null) Menu.getApplicationMenu()?.items[0]?.submenu?.popup({ window, x: 14, y: 40 })
  })
  ipcMain.handle(DESKTOP_IPC.windowColors, (event, background: unknown, foreground: unknown) => {
    assertDesktopSender(event, ['app', 'shell'])
    if (typeof background !== 'string' || typeof foreground !== 'string'
      || !/^#[\da-f]{6}$/i.test(background) || !/^#[\da-f]{6}$/i.test(foreground)) {
      throw new Error('Desktop title bar colors must be six-digit hex colors')
    }
    if (process.platform === 'win32') {
      BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({ color: background, symbolColor: foreground })
    }
  })
  ipcMain.handle(DESKTOP_IPC.pluginsList, (event, payload?: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (payload !== undefined) return nativeList(event, payload)
    if (development !== undefined) return []
    if (!manager.supportsLegacyPluginManagement()) throw new Error(messages.nativePluginManagementUnavailable)
    return manager.listPlugins()
  })
  ipcMain.handle(DESKTOP_IPC.pluginsAdd, (event, spec: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (isNativeDesktopPayload(spec)) {
      return nativeMutation(event, () => ({ type: 'install', request: parseNativeDesktopInstallRequest(spec) }))
    }
    if (typeof spec !== 'string') throw new Error('dsh desktop: plugin spec must be a string')
    return mutate(event, { type: 'plugin-add', spec })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsRemove, (event, name: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (isNativeDesktopPayload(name)) {
      return nativeMutation(event, () => ({ type: 'remove', request: parseNativeDesktopPackageRequest(name) }))
    }
    if (typeof name !== 'string') throw new Error('dsh desktop: plugin name must be a string')
    return mutate(event, { type: 'plugin-remove', name })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsUpdate, (event, name: unknown, version: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (isNativeDesktopPayload(name)) {
      return nativeMutation(event, () => ({ type: 'update', request: parseNativeDesktopUpdateRequest(name) }))
    }
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error('dsh desktop: plugin name and version must be strings')
    }
    return mutate(event, { type: 'plugin-update', name, version })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsToggle, (event, name: unknown, enabled: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (enabled === undefined && isNativeDesktopPayload(name)) {
      return nativeMutation(event, () => ({ type: 'toggle', request: parseNativeDesktopToggleRequest(name) }))
    }
    if (typeof name !== 'string' || typeof enabled !== 'boolean') throw new Error('dsh desktop: invalid plugin activation request')
    return mutate(event, { type: 'plugin-toggle', name, enabled })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsDisableAll, (event, payload?: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (payload !== undefined) {
      return nativeMutation(event, () => ({ type: 'disable-all', request: parseNativeDesktopMutationRequest(payload) }))
    }
    return mutate(event, { type: 'plugins-disable-all' })
  })
  ipcMain.handle(DESKTOP_IPC.backendStatus, (event) => {
    assertDesktopSender(event, ['shell'])
    return backendState()
  })
  ipcMain.handle(DESKTOP_IPC.backendRetry, async (event) => {
    assertDesktopSender(event, ['shell'])
    try { await reconcileBackend() } catch { return }
    focusPrimaryWindow()
  })
  ipcMain.handle(DESKTOP_IPC.applicationRestart, async (event) => {
    assertDesktopSender(event, ['shell'])
    try {
      await recoverApplication('restart')
    } catch (error) {
      await showStartupError(error)
    }
  })
  ipcMain.handle(DESKTOP_IPC.configurationReset, async (event) => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) throw new Error('Desktop configuration reset requires a packaged application')
    const failure = backendState()
    if (failure.phase !== 'error') {
      throw new Error('Desktop profile reset requires a startup failure')
    }
    await startup?.catch(() => undefined)
    try {
      await recoverApplication('reset')
    } catch (error) {
      await showStartupError(error)
    }
  })
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['shell'])
    return updates.check()
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['shell'])
    await updates.install()
  })

  const checkAndPrompt = async (manual: boolean): Promise<void> => {
    const state = await updates.check()
    if (state.phase === 'error') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'error',
          title: messages.updateCheckFailedTitle,
          message: state.message ?? messages.unknownError,
        })
      }
      return
    }
    if (state.phase !== 'available') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: messages.updateCheckTitle,
          message: state.message ?? messages.updateCurrent,
        })
      }
      return
    }
    const result = await dialog.showMessageBox({
      type: 'info',
      title: messages.updateTitle,
      message: messages.updateAvailable,
      detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
      buttons: [messages.installAndRestart, messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    const installed = await updates.install()
    if (installed.phase === 'error') {
      await dialog.showMessageBox({
        type: 'error',
        title: messages.updateFailedTitle,
        message: installed.message ?? messages.unknownError,
      })
    }
  }

  const openPluginWindow = (): void => {
    if (!manager.supportsLegacyPluginManagement() && !manager.supportsNativeModuleManagement()) {
      void dialog.showMessageBox({ type: 'info', title: messages.pluginWindowTitle, message: messages.nativePluginManagementUnavailable })
        .catch((error: unknown) => { console.error(error) })
      return
    }
    if (pluginWindow !== undefined && !pluginWindow.isDestroyed()) {
      pluginWindow.focus()
      return
    }
    pluginWindow = createWindow(managementPreload)
    pluginWindow.setSize(900, 620)
    pluginWindow.setTitle(messages.pluginWindowTitle)
    pluginWindow.once('ready-to-show', () => { pluginWindow?.show() })
    pluginWindow.once('closed', () => { pluginWindow = undefined })
    void pluginWindow.loadURL(`${SCHEME}://shell/plugin-manager.html`)
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: process.platform === 'darwin' ? app.name : messages.application,
    submenu: [
      {
        label: development === undefined ? messages.pluginsMenu : messages.pluginsMenuPackagedOnly,
        accelerator: 'CmdOrCtrl+,',
        enabled: development === undefined,
        click: openPluginWindow,
      },
      { label: messages.checkUpdatesMenu, click: () => { void checkAndPrompt(true) } },
      { type: 'separator' },
      { role: 'quit', label: messages.quit },
    ],
  }]))

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload, true)
    mainWindow = window
    window.on('closed', () => {
      if (mainWindow === window) { mainWindow = undefined; petUpdatesAllowed = false; desktopPet.close() }
    })
    window.webContents.on('preload-error', (_event, _path, error) => {
      void showEmergencyError(error).catch((failure: unknown) => { console.error(failure) })
    })
    let reloadedAfterCrash = false
    window.webContents.on('render-process-gone', (_event, details) => {
      const crashedApplication = petUpdatesAllowed
      navigation = undefined
      emergencyDocument = false
      petUpdatesAllowed = false
      desktopPet.close()
      if (crashedApplication && !reloadedAfterCrash && backendState().phase === 'ready') {
        reloadedAfterCrash = true
        void navigateMain(applicationUrl).catch(showStartupError).catch((failure: unknown) => { console.error(failure) })
        return
      }
      void showStartupError(new Error(`Desktop renderer exited: ${details.reason}`))
        .catch((failure: unknown) => { console.error(failure) })
    })
    return window
  }
  focusPrimaryWindow = () => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) {
      createMainWindow()
      void navigateMain(backendState().phase === 'ready' ? applicationUrl : startupUrl)
        .catch((error: unknown) => { console.error(error) })
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitReady) return
    event.preventDefault()
    if (shellInstallerOwnsQuit) {
      ordinaryQuitRequested = true
      return
    }
    if (quitting) return
    quitting = true
    desktopPet.close()
    void (async () => {
      try { await backend.close() }
      finally { await nativeMutationPromise?.catch(() => undefined) }
    })().catch((error: unknown) => { console.error(error) }).finally(() => {
      quitReady = true
      app.quit()
    })
  })

  mainWindow = createMainWindow()
  await reconcileBackend().catch(() => undefined)
  // Window lifecycle callbacks run while backend startup is pending.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (quitting) return
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (mainWindow !== undefined && development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
  setTimeout(() => { void checkAndPrompt(false) }, 10_000)
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  logDesktopError('Desktop initialization failed', error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`).catch(() => undefined)
  }
  const window = BrowserWindow.getAllWindows()[0] ?? createWindow(fileURLToPath(new URL('./preload-app.cjs', import.meta.url)), true)
  window.once('closed', () => { app.quit() })
  await showEmergencyDocument(window, desktopErrorState(error))
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
