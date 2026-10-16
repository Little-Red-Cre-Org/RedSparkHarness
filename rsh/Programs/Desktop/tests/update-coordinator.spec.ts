import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AppUpdater } from 'electron-updater'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { parseDesktopRelease } from '../src/release.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'

const updaterApp = Object.assign(new EventEmitter(), { isPackaged: false })

vi.mock('electron', () => ({ app: updaterApp }))
vi.mock('electron-updater', () => ({
  default: { autoUpdater: { autoDownload: true, autoInstallOnAppQuit: true } },
}))

const { DesktopUpdateCoordinator } = await import('../src/update-coordinator.ts')

afterEach(() => { updaterApp.removeAllListeners() })

describe('desktop release metadata', () => {
  it('accepts one exact release identity for Electron and dsh', () => {
    expect(parseDesktopRelease({
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    })).toEqual({
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    })
  })

  it('rejects invalid versions and unsupported host protocols', () => {
    const base = {
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    }
    expect(() => parseDesktopRelease({ ...base, version: 'latest' })).toThrow(/invalid desktop release metadata/u)
    expect(() => parseDesktopRelease({ ...base, hostProtocolVersion: 999 })).toThrow(/invalid desktop release metadata/u)
  })
})

describe('desktop update coordinator', () => {
  it('installs one Electron release and restarts after download', async () => {
    const states: DesktopUpdateState[] = []
    const downloadUpdate = vi.fn(async () => [])
    const quitAndInstall = vi.fn()
    const beforeRestart = vi.fn(async () => {})
    const updater = Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: '1.1.0' },
      })),
      downloadUpdate,
      quitAndInstall,
    }) as unknown as AppUpdater
    quitAndInstall.mockImplementation(() => {
      setImmediate(() => updaterApp.emit('before-quit'))
      void Promise.resolve().then(() => updater.emit('error', new Error('installer could not start')))
    })
    const afterFailedRestart = vi.fn(async () => {})
    const coordinator = new DesktopUpdateCoordinator(
      (state) => {
        states.push(state)
        return state
      },
      beforeRestart,
      afterFailedRestart,
      updater,
      () => true,
    )

    await expect(coordinator.check()).resolves.toEqual({ phase: 'available', version: '1.1.0' })
    await expect(coordinator.install()).resolves.toEqual({ phase: 'ready', version: '1.1.0' })
    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(beforeRestart).toHaveBeenCalledOnce()
    expect(afterFailedRestart).not.toHaveBeenCalled()
    expect(quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(states.map(state => state.phase)).toEqual(['checking', 'available', 'installing', 'ready'])
  })

  it('queues install behind an in-flight check instead of returning the check result', async () => {
    const checked = Promise.withResolvers<{
      isUpdateAvailable: true
      updateInfo: { version: string }
    }>()
    const downloadUpdate = vi.fn(async () => [])
    const updater = Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn(() => checked.promise),
      downloadUpdate,
      quitAndInstall: vi.fn(() => { updaterApp.emit('before-quit') }),
    }) as unknown as AppUpdater
    const coordinator = new DesktopUpdateCoordinator(state => state, async () => {}, async () => {}, updater, () => true)

    const checking = coordinator.check()
    const installing = coordinator.install()
    expect(downloadUpdate).not.toHaveBeenCalled()
    checked.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.2.0' } })

    await expect(checking).resolves.toEqual({ phase: 'available', version: '1.2.0' })
    await expect(installing).resolves.toEqual({ phase: 'ready', version: '1.2.0' })
    expect(downloadUpdate).toHaveBeenCalledOnce()
  })

  it.each(['asynchronous', 'synchronous'] as const)(
    'recovers a %s installer error and retries the retained release',
    async (timing) => {
      const proxySecret = 'fake-proxy-secret'
      const recoverySecret = 'fake-recovery-secret'
      const updaterErrorMessage = `connect failed via https://proxyuser:${proxySecret}@proxy.invalid`
      const recoveryErrorMessage = `Host recovery failed via https://recover:${recoverySecret}@proxy.invalid`
      const states: DesktopUpdateState[] = []
      const downloadUpdate = vi.fn(async () => [])
      const quitAndInstall = vi.fn()
      const updater = Object.assign(new EventEmitter(), {
        autoDownload: true,
        autoInstallOnAppQuit: true,
        checkForUpdates: vi.fn(async () => ({
          isUpdateAvailable: true,
          updateInfo: { version: '1.3.0' },
        })),
        downloadUpdate,
        quitAndInstall,
      }) as unknown as AppUpdater
      const beforeRestart = vi.fn(async () => {})
      const afterFailedRestart = vi.fn(async () => { throw new Error(recoveryErrorMessage) })
      const logError = vi.fn((_label: string, _error: unknown) => timing === 'asynchronous' ? '/logs/desktop.log' : undefined)
      const coordinator = new DesktopUpdateCoordinator(
        (state) => { states.push(state); return state }, beforeRestart, afterFailedRestart, updater, () => true, logError,
      )
      quitAndInstall.mockImplementationOnce(() => {
        const error = new Error(updaterErrorMessage)
        if (timing === 'synchronous') updater.emit('error', error)
        else void Promise.resolve().then(() => updater.emit('error', error))
      })
      quitAndInstall.mockImplementationOnce(() => { updaterApp.emit('before-quit') })

      await coordinator.check()
      await expect(coordinator.install()).resolves.toEqual({
        phase: 'error', version: '1.3.0', errorType: 'AggregateError',
        ...(timing === 'asynchronous' ? { logPath: '/logs/desktop.log' } : {}),
      })
      expect(afterFailedRestart).toHaveBeenCalledOnce()
      expect(logError).toHaveBeenCalledOnce()
      expect(logError).toHaveBeenCalledWith('Desktop update failed', expect.any(AggregateError))
      const failure = logError.mock.calls[0]![1] as AggregateError
      expect(failure.errors.map((error: unknown) => (error as Error).message)).toEqual([
        updaterErrorMessage, recoveryErrorMessage,
      ])
      await expect(coordinator.install()).resolves.toEqual({ phase: 'ready', version: '1.3.0' })
      expect(beforeRestart).toHaveBeenCalledTimes(2)
      expect(downloadUpdate).toHaveBeenCalledTimes(2)
      expect(quitAndInstall).toHaveBeenCalledTimes(2)
      const errorState = states.find(state => state.phase === 'error')
      expect(errorState).toEqual({
        phase: 'error', version: '1.3.0', errorType: 'AggregateError',
        ...(timing === 'asynchronous' ? { logPath: '/logs/desktop.log' } : {}),
      })
      expect(JSON.stringify(states)).not.toContain(proxySecret)
      expect(JSON.stringify(states)).not.toContain(recoverySecret)
      expect(afterFailedRestart).toHaveBeenCalledOnce()
    },
    1_000,
  )
})
