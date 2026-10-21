/** Run one explicitly native profile through the public dsh launcher. */
import { fileURLToPath } from 'node:url'
import type { NativeApplication } from '@deepseek-ai/dsh-native-runtime'
import { loadNativeProfile } from './native-profile-loader.ts'
import { createProcessShutdown } from './process-shutdown.ts'

/** Launch the selected native application and await complete host teardown. */
export async function runNativeProfile(options: {
  profile: string
  patchFiles: readonly string[]
  args: readonly string[]
  home?: string
}): Promise<void> {
  let application: NativeApplication | undefined
  const loaded = await loadNativeProfile({
    profile: options.profile,
    patchFiles: options.patchFiles,
    target: 'host',
    installAnchor: fileURLToPath(import.meta.url),
    onApplication: (selected) => { application = selected },
    ...options.home === undefined ? {} : { home: options.home },
  })
  const { host } = loaded
  const selected = [...loaded.requests.values()].find(request => request.plugin.provides.includes('application'))
  if (selected === undefined) throw new Error('native profile lost its application')
  const shutdown = createProcessShutdown(() => host.stop())
  const onTerm = (): void => { shutdown.interrupt(0) }
  const onInterrupt = (): void => { shutdown.interrupt(130) }
  process.once('SIGTERM', onTerm)
  process.once('SIGINT', onInterrupt)
  try {
    await host.start()
    if (application === undefined) throw new Error('native application was not published')
    const selectedApplication = application
    const code = await host.run(selected.scope, { kind: 'dsh-cli' }, invocation => selectedApplication.run(options.args, invocation.signal))
    await shutdown.shutdown(code)
  } finally {
    process.removeListener('SIGTERM', onTerm)
    process.removeListener('SIGINT', onInterrupt)
    await host.stop()
  }
}
