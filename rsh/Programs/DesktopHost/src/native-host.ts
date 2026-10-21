/** Cordis-free native composition over Electron's existing private Fetch carrier. */
import { join } from 'node:path'
import { loadNativeProfile, readNativeProfile, profileDirectoryReloadMode } from '@deepseek-ai/dsh/native-profile'
import { createNativeHostConnectionRegistry, type ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection/native-host'
import { createNativeDesktopAssetHandler, prepareNativeClientBundle } from '@deepseek-ai/dsh-native-web-assets'
import type {} from '@deepseek-ai/dsh-native-web-session-controller'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { DesktopHostRuntime } from './runtime.ts'

/**
 * Activate an explicitly native profile without a public HTTP listener or another Agent loop.
 * @param runtimeDir - immutable installed npm runtime root.
 * @param projectDir - installed or staged Desktop profile.
 * @returns private native RPC and Client asset dispatch plus Host drain.
 */
export async function createNativeDesktopRuntime(runtimeDir: string, projectDir: string): Promise<DesktopHostRuntime> {
  if (profileDirectoryReloadMode(projectDir) !== 'startup') throw new Error('dsh desktop: native profiles require configReload startup')
  const profile = readNativeProfile({ profile: 'desktop', profileDir: projectDir, patchFiles: [] })
  const root = profile.scopes.find(scope => scope.parent === undefined)
  if (root === undefined) throw new Error('dsh desktop: native profile has no root scope')
  const bundle = await prepareNativeClientBundle(projectDir, runtimeDir, true)
  if (bundle === undefined) throw new Error('dsh desktop: native Host requires rsh.client.json')
  const assets = createNativeDesktopAssetHandler(runtimeDir, bundle, 'globalThis.__DSH_TRANSPORT__={ownsHost:true}')
  const channels = new Map<string, ConnectionFetchHandler>()
  let api: ConnectionFetchHandler | undefined
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'desktop-private-carrier', targets: ['host'],
    requires: ['credentials'], provides: ['hostConnection', 'application'],
    resolve: () => async (context) => {
      const registry = await createNativeHostConnectionRegistry({}, context.require('credentials'))
      const connection = registry.forOwner({
        effect: setup => context.effect(setup()),
        mount: (channel, handler) => {
          if (channels.has(channel)) throw new Error('dsh desktop: duplicate private RPC channel')
          channels.set(channel, handler)
          return () => { channels.delete(channel) }
        },
      })
      api = connection.createSharedFetchHandler('/api')
      context.provide('hostConnection', connection)
      // Electron's IPC owner runs the application; profile entries cannot start another carrier.
      context.provide('application', { run: () => Promise.reject(new Error('dsh desktop: private carrier is owned by Electron')) })
    },
  }
  const loaded = await loadNativeProfile({
    profile: 'desktop', profileDir: projectDir, patchFiles: [], target: 'host',
    installAnchor: join(runtimeDir, 'package.json'), containedRoots: [projectDir, runtimeDir],
    carrier: { plugin: carrier, scope: root.id },
  })
  if ([...loaded.requests.values()].some(request => request.plugin.provides.some(service => service === 'application' || service === 'hostConnection'))) {
    throw new Error('dsh desktop: native profile cannot select another application or Connection carrier')
  }
  const controllers = [...loaded.requests.values()].filter(request => request.plugin.provides.includes('nativeWebSession'))
  if (controllers.length !== 1) throw new Error('dsh desktop: native profile must select exactly one native Session controller')
  await loaded.host.start()
  if (api === undefined) {
    await loaded.host.stop()
    throw new Error('dsh desktop: native carrier did not activate')
  }
  const handler = api
  return {
    fetch(request) {
      const url = new URL(request.url)
      if (url.protocol !== 'dsh-app:' || url.host !== 'app' || url.username !== '' || url.password !== '') {
        return Promise.resolve(new Response(null, { status: 403 }))
      }
      const channel = channels.get(url.pathname.split('/').slice(0, 2).join('/'))
      return url.pathname.startsWith('/api/') ? handler.fetch(request) : channel !== undefined ? channel.fetch(request) : assets.fetch(request)
    },
    dispose: () => loaded.host.stop(),
  }
}
