/** Run one explicitly native profile through the public dsh launcher. */
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NativeApplication, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { loadLayeredEnv } from '@deepseek-ai/dsh-launch-environment/layers'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { loadNativeProfile, readNativeProfile, refuseLegacyPatch, replaceNativeProfile } from './native-profile-loader.ts'
import { nativeProfileReloadMode } from './native-profile-config.ts'
import { migrateNativeLegacyConfig } from './native-legacy-config.ts'
import { createProcessShutdown } from './process-shutdown.ts'

const SDK_CHILD_APPROVAL_RELAY_ENV = 'DSH_NATIVE_SDK_CHILD_APPROVAL_RELAY'

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

/** The process proxy installation shared by overlapping native launches; the last owner releases it. */
let sharedProxy: { owners: number; installed: Promise<() => Promise<void>> } | undefined

async function acquireProxy(environment: Parameters<typeof installProxyFromEnvironment>[0]): Promise<() => Promise<void>> {
  const shared = sharedProxy ??= { owners: 0, installed: installProxyFromEnvironment(environment,
    (message) => { process.stderr.write(`dsh: ${message}\n`) }) }
  shared.owners++
  let dispose: () => Promise<void>
  try {
    dispose = await shared.installed
  } catch (error) {
    if (sharedProxy === shared) sharedProxy = undefined
    throw error
  }
  return async () => {
    if (--shared.owners > 0) return
    if (sharedProxy === shared) sharedProxy = undefined
    await dispose()
  }
}

/** Check legacy launch configuration, migrate supported settings, then launch a native application.
 * Overlapping launches share the process proxy installation until the last Host has stopped.
 * @param options - selected profile, ordered JSON patches, app arguments, and optional Harness home.
 * @returns completion after application exit and complete Host teardown.
 * @throws when legacy configuration is unsupported or native profile startup fails.
 */
export async function runNativeProfile(options: {
  profile: string
  patchFiles: readonly string[]
  args: readonly string[]
  home?: string
}): Promise<void> {
  const home = options.home ?? resolveDshHome()
  const environment = loadLayeredEnv('dsh')
  const profileDirectory = join(home, 'profiles', options.profile)
  refuseLegacyPatch(join(profileDirectory, 'cordis.yml'))
  const profile = readNativeProfile({ profile: options.profile, patchFiles: options.patchFiles, home })
  await migrateNativeLegacyConfig({ profileName: options.profile,
    installAnchor: fileURLToPath(import.meta.url), home, profile, patchFiles: options.patchFiles, environment })
  const live = nativeProfileReloadMode(options.profile, home) === 'live'
  let application: NativeApplication | undefined
  const onApplication = (selected: NativeApplication): void => { application = selected }
  let carrier: { readonly plugin: NativePlugin; readonly scope: string } | undefined
  if (options.profile === 'native-sdk' && process.env[SDK_CHILD_APPROVAL_RELAY_ENV] === '1') {
    const { plugin } = await import('@deepseek-ai/dsh-native-approval/native')
    carrier = { plugin, scope: 'root' }
  }
  const disposeProxy = await acquireProxy(environment)
  let proxyDisposal: Promise<void> | undefined
  const releaseProxy = (): Promise<void> => proxyDisposal ??= disposeProxy()
  let loaded = await loadNativeProfile({
    profile: options.profile,
    patchFiles: options.patchFiles,
    target: 'host',
    installAnchor: fileURLToPath(import.meta.url),
    onApplication,
    home,
    environment,
    ...(carrier === undefined ? {} : { carrier }),
  }).catch(async (error: unknown) => {
    await releaseProxy()
    throw error
  })
  const { host } = loaded
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
    await releaseProxy()
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
        environment,
        ...(carrier === undefined ? {} : { carrier }),
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
    try {
      await reloadWork
      await host.stop()
    } finally {
      await releaseProxy()
    }
  }
}
