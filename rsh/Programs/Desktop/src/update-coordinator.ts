/** One Electron release stream for the version-bound shell and bundled dsh runtime. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { DesktopUpdateState } from './ipc.ts'
import { desktopErrorState } from './startup-error.ts'
const { autoUpdater } = electronUpdater

/** Checks, downloads, and installs one complete Desktop release. */
export class DesktopUpdateCoordinator {
  private availableVersion: string | undefined
  private checkOperation: Promise<DesktopUpdateState> | undefined
  private installOperation: Promise<DesktopUpdateState> | undefined

  /**
   * @param publish - state sink for every desktop window.
   * @param beforeRestart - stop application-owned processes before replacement.
   * @param afterFailedRestart - restore the application after an installation handoff fails.
   * @param updater - Electron artifact updater; replaceable for tests.
   * @param enabled - whether this packaged process carries updater configuration.
   * @param logError - persist raw update failures and return the log path when writing succeeds.
   */
  constructor(
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly beforeRestart: () => Promise<void> = async () => {},
    private readonly afterFailedRestart: () => Promise<void> = async () => {},
    private readonly updater: AppUpdater = autoUpdater,
    private readonly enabled: () => boolean = () => (
      app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
    ),
    private readonly logError: (label: string, error: unknown) => string | undefined = (label, error) => {
      console.error(label, error)
      return undefined
    },
  ) {
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
  }

  /** Check the configured Desktop release stream and retain an available version. */
  async check(): Promise<DesktopUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation
    if (this.checkOperation !== undefined) return this.checkOperation
    this.checkOperation = this.doCheck().finally(() => { this.checkOperation = undefined })
    return this.checkOperation
  }

  /** Wait for an in-flight check, then download and install its retained release. */
  async install(): Promise<DesktopUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation
    this.installOperation = (async () => {
      await this.checkOperation
      return this.doInstall()
    })().finally(() => { this.installOperation = undefined })
    return this.installOperation
  }

  private async doCheck(): Promise<DesktopUpdateState> {
    this.publish({ phase: 'checking' })
    try {
      if (!this.enabled()) {
        this.availableVersion = undefined
        return this.publish({ phase: 'idle' })
      }
      const result = await this.updater.checkForUpdates()
      const version = result?.isUpdateAvailable === true ? result.updateInfo.version : undefined
      this.availableVersion = version
      return version === undefined
        ? this.publish({ phase: 'idle' })
        : this.publish({ phase: 'available', version })
    } catch (error) {
      this.availableVersion = undefined
      return this.failed(error)
    }
  }

  private async doInstall(): Promise<DesktopUpdateState> {
    const version = this.availableVersion
    if (version === undefined) {
      throw new Error('desktop update: no verified update is available')
    }
    this.publish({ phase: 'installing', version })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      return this.failed(error, version)
    }
    this.availableVersion = undefined
    const ready = this.publish({ phase: 'ready', version })
    try {
      await this.beforeRestart()
    } catch (error) {
      return this.failedRestart(version, error)
    }
    return new Promise((resolve) => {
      let settled = false
      let quitAndInstallReturned = false
      let updaterError: Error | undefined
      const cleanup = (): void => {
        this.updater.off('error', onError)
        app.off('before-quit', onBeforeQuit)
      }
      const finish = (state: DesktopUpdateState): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(state)
      }
      const onBeforeQuit = (): void => { finish(ready) }
      const recoverAfterQuitAttempt = (): void => {
        if (settled || !quitAndInstallReturned || updaterError === undefined) return
        const error = updaterError
        // Let a quitAndInstall-queued app.quit emit before-quit before recovering the error.
        setImmediate(() => {
          if (settled) return
          settled = true
          cleanup()
          void this.failedRestart(version, error).then(resolve)
        })
      }
      const onError = (error: Error): void => { updaterError = error; recoverAfterQuitAttempt() }
      this.updater.on('error', onError)
      app.on('before-quit', onBeforeQuit)
      try {
        this.updater.quitAndInstall(false, true)
        quitAndInstallReturned = true
        recoverAfterQuitAttempt()
      } catch (error) {
        quitAndInstallReturned = true
        updaterError = error instanceof Error ? error : new Error(String(error))
        recoverAfterQuitAttempt()
      }
    })
  }

  private async failedRestart(version: string, error: unknown): Promise<DesktopUpdateState> {
    this.availableVersion = version
    let failure = error
    try {
      await this.afterFailedRestart()
    } catch (recoveryError) {
      failure = new AggregateError([error, recoveryError], 'Desktop update and recovery failed')
    }
    return this.failed(failure, version)
  }

  private failed(error: unknown, version?: string): DesktopUpdateState {
    const logPath = this.logError('Desktop update failed', error)
    return this.publish({
      phase: 'error',
      ...(version === undefined ? {} : { version }),
      errorType: desktopErrorState(error).errorType,
      ...(logPath === undefined ? {} : { logPath }),
    })
  }
}
