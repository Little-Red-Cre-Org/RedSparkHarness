/** Run one explicitly native profile through the public dsh launcher. */
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NativeApplication } from '@deepseek-ai/dsh-native-runtime'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { loadNativeProfile, replaceNativeProfile } from './native-profile-loader.ts'
import { nativeProfileReloadMode } from './native-profile-config.ts'
import { createProcessShutdown } from './process-shutdown.ts'

function watchProfileFiles(files: readonly string[], changed: () => void, failed: (error: Error) => void): () => void {
  const directories = new Map<string, Set<string>>()
  for (const file of files) {
    const path = resolve(file)
    const directory = dirname(path)
    const names = directories.get(directory) ?? new Set<string>()
    names.add(basename(path))
    directories.set(directory, names)
  }
  const watchers: FSWatcher[] = []
  try {
    for (const [directory, names] of directories) {
      const watcher = watch(directory, (_event, filename) => {
        if (filename === null || names.has(filename)) changed()
      })
      watcher.on('error', failed)
      watchers.push(watcher)
    }
  } catch (error) {
    for (const watcher of watchers) watcher.close()
    throw error
  }
  return () => { for (const watcher of watchers) watcher.close() }
}

// NativeHost has no typed admission result: these are its current pre-callback interruption forms.
function isNativeRunAdmissionInterruption(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' || error.message === 'native-runtime: host is changing installations'
  )
}

/** Launch the selected native application and await complete host teardown. */
export async function runNativeProfile(options: {
  profile: string
  patchFiles: readonly string[]
  args: readonly string[]
  home?: string
}): Promise<void> {
  let application: NativeApplication | undefined
  const home = options.home ?? resolveDshHome()
  const onApplication = (selected: NativeApplication): void => { application = selected }
  let loaded = await loadNativeProfile({
    profile: options.profile,
    patchFiles: options.patchFiles,
    target: 'host',
    installAnchor: fileURLToPath(import.meta.url),
    onApplication,
    home,
  })
  const { host } = loaded
  const live = nativeProfileReloadMode(options.profile, home) === 'live'
  let stopping = false
  let reloadPending = false
  let reloadBusy = false
  let reloadWork = Promise.resolve()
  let fatalReload: unknown
  let closeWatchers = (): void => {}
  const isStopping = (): boolean => stopping
  const hostIsAborted = (): boolean => host.signal.aborted
  const reloadIsPending = (): boolean => reloadPending || reloadBusy
  const terminalExitCode = (): number => fatalReload === undefined ? 0 : 1
  const shutdown = createProcessShutdown(async () => {
    stopping = true
    closeWatchers()
    const stopped = host.stop()
    await reloadWork
    await stopped
  })
  const rejectCandidate = (error: unknown): void => {
    process.stderr.write(`dsh: native profile reload rejected: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  const reload = async (): Promise<void> => {
    if (isStopping() || hostIsAborted()) return
    let candidate
    try {
      candidate = await loadNativeProfile({
        profile: options.profile, patchFiles: options.patchFiles, target: 'host',
        installAnchor: fileURLToPath(import.meta.url), home, previous: loaded, onApplication,
      })
    } catch (error) {
      if (!isStopping()) rejectCandidate(error)
      return
    }
    if (isStopping() || hostIsAborted()) return
    try {
      loaded = await replaceNativeProfile(host, candidate)
    } catch (error) {
      fatalReload = error
      process.stderr.write(`dsh: native profile reload stopped the Host: ${error instanceof Error ? error.message : String(error)}\n`)
      void shutdown.shutdown(1)
    }
  }
  const scheduleReload = (): void => {
    if (stopping || reloadPending) return
    reloadPending = true
    reloadWork = reloadWork.then(async () => {
      await Promise.resolve()
      reloadPending = false
      reloadBusy = true
      try { await reload() } finally { reloadBusy = false }
    })
  }
  const watcherFailed = (error: Error): void => {
    if (stopping) return
    fatalReload = error
    process.stderr.write(`dsh: native profile configuration watch failed: ${error.message}\n`)
    void shutdown.shutdown(1)
  }
  const onTerm = (): void => { shutdown.interrupt(0) }
  const onInterrupt = (): void => { shutdown.interrupt(130) }
  process.once('SIGTERM', onTerm)
  process.once('SIGINT', onInterrupt)
  try {
    await host.start()
    if (application === undefined) throw new Error('native application was not published')
    if (live) {
      const profileDir = join(home, 'profiles', options.profile)
      closeWatchers = watchProfileFiles([
        join(profileDir, 'rsh.profile.json'), ...options.patchFiles.map(file => resolve(file)),
      ], scheduleReload, watcherFailed)
      scheduleReload()
      await reloadWork
    }
    while (!hostIsAborted()) {
      const selected = [...loaded.requests.values()].find(request => request.plugin.provides.includes('application'))
      if (selected === undefined) throw new Error('native profile lost its application')
      const selectedApplication = application
      let result: { kind: 'exit'; code: number } | { kind: 'replaced' }
      const runState = { started: false }
      try {
        result = await host.run(selected.scope, { kind: 'dsh-cli' }, async (invocation) => {
          runState.started = true
          try {
            const code = await selectedApplication.run(options.args, invocation.signal)
            return invocation.signal.aborted ? { kind: 'replaced' as const } : { kind: 'exit' as const, code }
          } catch (error) {
            if (invocation.signal.aborted && error === invocation.signal.reason) return { kind: 'replaced' as const }
            throw error
          }
        })
      } catch (error) {
        if (!runState.started && !hostIsAborted() && reloadIsPending() && isNativeRunAdmissionInterruption(error)) {
          await reloadWork
          continue
        }
        throw error
      }
      if (result.kind === 'exit') {
        await shutdown.shutdown(result.code)
        break
      }
      if (hostIsAborted()) {
        await shutdown.shutdown(terminalExitCode())
        break
      }
      await reloadWork
    }
  } finally {
    process.removeListener('SIGTERM', onTerm)
    process.removeListener('SIGINT', onInterrupt)
    stopping = true
    closeWatchers()
    await reloadWork
    await host.stop()
  }
}
