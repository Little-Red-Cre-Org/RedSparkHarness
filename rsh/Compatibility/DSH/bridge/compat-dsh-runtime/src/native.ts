/** Optional Cordis context and owned plugin mounts for the DSH compatibility boundary. */
import { createRequire } from 'node:module'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { adaptCordisPlugin, RshPluginHost, RSH_PLUGIN_API_VERSION } from '@deepseek-ai/dsh-plugin-host'

const LEGACY_PLUGINS = new Set([
  '@deepseek-ai/dsh-fs-local',
  '@deepseek-ai/dsh-fs-observation-policy',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-compat-dsh-runtime/fs-adapter',
  '@deepseek-ai/dsh-compat-dsh-runtime/sandbox-policy-adapter',
  '@deepseek-ai/dsh-compat-dsh-runtime/fs-event-bridge',
])

/** Cordis operations exposed only to Compatibility/DSH adapters. */
export interface CompatDshRuntime {
  /** Shared Cordis service/event scope for the selected DSH adapter set. */
  readonly context: Context
  /** Start one allowlisted legacy plugin with cleanup registered before activation settles. */
  mount(packageName: string, plugin: Plugin, config?: unknown): CompatDshMount
}

/** Native-owned Cordis mount. Register dispose with the Native context before awaiting ready. */
export interface CompatDshMount {
  readonly ready: Promise<void>
  dispose(): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { compatDshRuntime: CompatDshRuntime }
}

interface CordisManifest { version?: unknown }

/** Require the supported Cordis major version before creating a runtime.
 * @param manifest - manifest read from the installed Cordis package.
 */
export function validateCordisManifest(manifest: CordisManifest): void {
  if (typeof manifest.version !== 'string' || !/^4\./u.test(manifest.version)) {
    throw new Error(`compat-dsh-runtime: unsupported Cordis version ${String(manifest.version)}`)
  }
}

function resolveConfig(input: unknown): void {
  if (input === undefined) return
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0) {
    throw new Error('compat-dsh-runtime: configuration must be empty')
  }
}

/** Start the explicit, optional Cordis host as a native installation. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-compat-dsh-runtime',
  targets: ['host'],
  requires: [],
  provides: ['compatDshRuntime'],
  resolve(input) {
    resolveConfig(input)
    const require = createRequire(import.meta.url)
    validateCordisManifest(require('@deepseek-ai/cordis/package.json') as CordisManifest)
    return async (native) => {
      const { Context } = await import('@deepseek-ai/cordis')
      const context = new Context()
      native.own(async () => {
        await context.fiber.dispose()
        while (context.fiber.inertia !== undefined) await context.fiber.inertia
      })
      await context.plugin(RshPluginHost)
      const mounts = new Map<string, CompatDshMount>()
      let disposed = false
      const disposeMount = (packageName: string, fiber: ReturnType<Context['plugin']>): (() => Promise<void>) => {
        let disposal: Promise<void> | undefined
        return () => disposal ??= (async () => {
          try {
            try { await fiber.dispose() } catch (error) {
              if (fiber.uid !== null) throw error
            }
            while (fiber.inertia !== undefined) {
              try { await fiber.inertia } catch (error) {
                if (fiber.uid !== null) throw error
              }
            }
          } finally {
            mounts.delete(packageName)
          }
        })()
      }
      const runtime: CompatDshRuntime = {
        context,
        mount(packageName, legacyPlugin, config) {
          if (disposed) throw new Error('compat-dsh-runtime: host is disposed')
          if (!LEGACY_PLUGINS.has(packageName)) throw new Error(`compat-dsh-runtime: unsupported plugin ${packageName}`)
          if (mounts.has(packageName)) throw new Error(`compat-dsh-runtime: ${packageName} is already mounted`)
          const descriptor = {
            packageName,
            apiVersion: RSH_PLUGIN_API_VERSION,
            role: 'adapter',
            capability: 'dsh-compatibility',
          } as const
          const fiber = context.plugin(adaptCordisPlugin(descriptor, legacyPlugin), config)
          const dispose = disposeMount(packageName, fiber)
          const starting = Promise.resolve(fiber).then(() => undefined, async (error: unknown) => {
            try { await dispose() } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], `compat-dsh-runtime: ${packageName} failed to activate and clean up`)
            }
            throw error
          })
          const mount = { ready: starting, dispose }
          mounts.set(packageName, mount)
          return mount
        },
      }
      native.own(() => {
        disposed = true
        mounts.clear()
      })
      native.provide('compatDshRuntime', runtime)
    }
  },
}
