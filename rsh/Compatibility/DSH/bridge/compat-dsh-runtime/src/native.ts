/** Optional Cordis context and owned Loader entries for the DSH compatibility boundary. */
import { createRequire } from 'node:module'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { adaptCordisPlugin, RshPluginHost, RSH_PLUGIN_API_VERSION } from '@deepseek-ai/dsh-plugin-host'
import { validateSupportManifest, type CompatPackageManifest } from './support.ts'

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
  /** Shared Cordis service and event scope for the selected DSH adapter set. */
  readonly context: Context
  /** Start one allowlisted plugin as a shared Loader entry.
   * @param packageName - supported installed package or internal adapter name.
   * @param plugin - Cordis plugin entrypoint.
   * @param config - configuration passed to that entrypoint.
   * @returns its activation promise and Loader-backed mutations.
   * @throws when the host is disposed, the name is unsupported or duplicate, or activation fails.
   */
  mount(packageName: string, plugin: Plugin, config?: unknown): CompatDshMount
  /** Update one entry after draining dependent Native contributions.
   * @param packageName - mounted Loader entry name.
   * @param config - replacement Cordis configuration.
   * @returns when Loader and Native contributions settle.
   * @throws when the entry is absent or its update fails.
   */
  update(packageName: string, config: unknown): Promise<void>
  /** Enable or disable one entry through its Loader lifecycle.
   * @param packageName - mounted Loader entry name.
   * @param enabled - true to start the entry or false to stop it.
   * @returns when Loader and Native contributions settle.
   * @throws when the entry is absent or its transition fails.
   */
  setEnabled(packageName: string, enabled: boolean): Promise<void>
  /** Remove one entry and its Cordis resources after draining Native contributions.
   * @param packageName - mounted Loader entry name.
   * @returns when the entry is removed; an absent entry is a no-op.
   * @throws when the entry or its Native contributions fail to dispose.
   */
  remove(packageName: string): Promise<void>
  /** Check whether the Native installation selected an entry, including a pending or disabled entry.
   * @param packageName - supported Loader entry name.
   * @returns true while the entry is selected.
   */
  hasEntry(packageName: string): boolean
  /** Check whether an allowlisted entry is mounted and enabled.
   * @param packageName - supported Loader entry name.
   * @returns true only after activation and while enabled.
   */
  isEnabled(packageName: string): boolean
  /** Resolve an object service on each access so provider replacement does not retain an old instance.
   * @param serviceName - Cordis service name.
   * @returns a proxy that reads the current service.
   * @throws when the service is unavailable at creation or property access.
   */
  liveService(serviceName: string): object
  /** Register Native contributions that must be withdrawn and restored around Loader mutations.
   * @param participant - async withdrawal and restoration functions.
   * @returns a disposer that unregisters the participant.
   */
  registerLifecycleParticipant(participant: CompatDshLifecycleParticipant): () => void
  /**
   * Coordinate observed-event forwarding so the identical event is not sent back between buses synchronously.
   * @param scope - native scope whose event is being bridged.
   * @param target - stable filesystem target passed to the event.
   * @param observation - presence and version passed to the event.
   * @param actor - observing tool identity, when present.
   * @param forward - synchronous dispatch into the other event bus.
   */
  forwardFsObserved(scope: object, target: object, observation: object, actor: object | undefined, forward: () => void): void
}

/** Native contributions that follow one or more Loader entries. */
export interface CompatDshLifecycleParticipant {
  /** Withdraw exposed resources and await work admitted through them.
   * @returns when no admitted work or listener remains.
   */
  suspend(): Promise<void>
  /** Rebuild resources from the settled current Loader entries.
   * @returns when the participant's current resources are available.
   */
  resume(): Promise<void>
}

/** Native-owned Cordis entry. Register dispose with the Native context before awaiting ready. */
export interface CompatDshMount {
  readonly ready: Promise<void>
  /** Update this entry's config after dependent Native work drains.
   * @param config - replacement Cordis configuration.
   * @returns when Loader and Native contributions settle.
   */
  update(config: unknown): Promise<void>
  /** Enable or disable this entry after dependent Native work drains.
   * @param enabled - true to start the entry or false to stop it.
   * @returns when Loader and Native contributions settle.
   */
  setEnabled(enabled: boolean): Promise<void>
  /** Remove this entry and its Cordis resources.
   * @returns when removal settles.
   */
  dispose(): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { compatDshRuntime: CompatDshRuntime }
}

/** Require the verified Cordis release before creating a runtime.
 * @param manifest - manifest read from the installed Cordis package.
 */
export function validateCordisManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@deepseek-ai/cordis', manifest)
}

/** Require the verified vendored Loader release before creating a runtime.
 * @param manifest - manifest read from the installed Loader package.
 */
export function validateLoaderManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@deepseek-ai/cordis-plugin-loader', manifest)
}

function resolveConfig(input: unknown): void {
  if (input === undefined) return
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0) {
    throw new Error('compat-dsh-runtime: configuration must be empty')
  }
}

interface MountState {
  readonly id: string
  ready: Promise<void>
  enabled: boolean
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
    validateCordisManifest(require('@deepseek-ai/cordis/package.json') as CompatPackageManifest)
    validateLoaderManifest(require('@deepseek-ai/cordis-plugin-loader/package.json') as CompatPackageManifest)
    return async (native) => {
      const { Context } = await import('@deepseek-ai/cordis')
      const context = new Context()
      native.own(async () => {
        await context.fiber.dispose()
        while (context.fiber.inertia !== undefined) await context.fiber.inertia
      })
      await context.plugin(RshPluginHost)
      await context.plugin(Loader)
      const loader = context.loader
      const mounts = new Map<string, MountState>()
      const participants = new Set<CompatDshLifecycleParticipant>()
      const activeObservations: { scope: object; target: object; observation: object; actor: object | undefined }[] = []
      let disposed = false
      // One Loader tree has one writer. Keep rejected operations from poisoning later entries in the queue.
      let operationTail: Promise<void> = Promise.resolve()

      const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
        if (disposed) return Promise.reject(new Error('compat-dsh-runtime: host is disposed'))
        const result = operationTail.then(operation, operation)
        operationTail = result.then(() => undefined, () => undefined)
        return result
      }
      const withLifecycle = async <T>(operation: () => Promise<T>): Promise<T> => {
        const paused: CompatDshLifecycleParticipant[] = []
        const failures: unknown[] = []
        let result: T | undefined
        // The Native dependency graph registers policy before consumer bridges, so restore in dependency order.
        for (const participant of [...participants].reverse()) {
          paused.push(participant)
          try { await participant.suspend() } catch (error) {
            failures.push(error)
            break
          }
        }
        if (failures.length === 0) {
          try { result = await operation() } catch (error) { failures.push(error) }
        }
        for (const participant of paused.reverse()) {
          try { await participant.resume() } catch (error) { failures.push(error) }
        }
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'compat-dsh-runtime: Loader change failed')
        return result as T
      }
      const forgetMount = (packageName: string, state: MountState): void => {
        if (mounts.get(packageName) === state) mounts.delete(packageName)
        state.enabled = false
        Reflect.deleteProperty(loader.builtins, packageName)
      }
      const cleanupMount = async (packageName: string, state: MountState): Promise<void> => {
        if (loader.store[state.id] === undefined) {
          forgetMount(packageName, state)
          return
        }
        try {
          await withLifecycle(async () => {
            if (loader.store[state.id] !== undefined) await loader.remove(state.id)
            await loader.await()
          })
        } finally {
          if (loader.store[state.id] === undefined) forgetMount(packageName, state)
        }
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
          loader.builtins[packageName] = adaptCordisPlugin(descriptor, legacyPlugin)
          const options = { id: packageName, name: `cordis:${packageName}`, config }
          const id = loader.ensureId(options)
          const state: MountState = { id, ready: Promise.resolve(), enabled: false }
          mounts.set(packageName, state)
          state.ready = serialize(async () => {
            try {
              await withLifecycle(async () => {
                try {
                  await loader.create(options)
                  await loader.await()
                  state.enabled = true
                } catch (error) {
                  const failures: unknown[] = [error]
                  try {
                    if (loader.store[id] !== undefined) await loader.remove(id)
                    await loader.await()
                  } catch (cleanupError) { failures.push(cleanupError) }
                  if (loader.store[id] === undefined) forgetMount(packageName, state)
                  if (failures.length > 1) {
                    throw new AggregateError(failures, `compat-dsh-runtime: ${packageName} failed to activate and clean up`)
                  }
                  throw error
                }
              })
            } catch (error) {
              const failures: unknown[] = [error]
              try { await cleanupMount(packageName, state) } catch (cleanupError) { failures.push(cleanupError) }
              if (failures.length > 1) {
                throw new AggregateError(failures, `compat-dsh-runtime: ${packageName} failed to mount and clean up`)
              }
              throw error
            }
          })
          return {
            ready: state.ready,
            update: nextConfig => runtime.update(packageName, nextConfig),
            setEnabled: enabled => runtime.setEnabled(packageName, enabled),
            dispose: () => runtime.remove(packageName),
          }
        },
        async update(packageName, config) {
          const state = mounts.get(packageName)
          if (state === undefined) throw new Error(`compat-dsh-runtime: ${packageName} is not mounted`)
          await state.ready
          await serialize(async () => {
            if (mounts.get(packageName) !== state) throw new Error(`compat-dsh-runtime: ${packageName} is not mounted`)
            await withLifecycle(async () => {
              await loader.update(state.id, { config })
              await loader.await()
            })
          })
        },
        async setEnabled(packageName, enabled) {
          const state = mounts.get(packageName)
          if (state === undefined) throw new Error(`compat-dsh-runtime: ${packageName} is not mounted`)
          await state.ready
          await serialize(async () => {
            if (mounts.get(packageName) !== state) throw new Error(`compat-dsh-runtime: ${packageName} is not mounted`)
            if (state.enabled === enabled) return
            await withLifecycle(async () => {
              await loader.update(state.id, { disabled: enabled ? null : true })
              await loader.await()
              state.enabled = enabled
            })
          })
        },
        async remove(packageName) {
          const state = mounts.get(packageName)
          if (state === undefined) return
          // `ready` reports activation failure; remove must still clean any partial Loader entry.
          await Promise.allSettled([state.ready])
          await serialize(async () => {
            if (mounts.get(packageName) !== state) return
            if (loader.store[state.id] === undefined) {
              forgetMount(packageName, state)
              return
            }
            const wasEnabled = state.enabled
            try {
              await withLifecycle(async () => {
                state.enabled = false
                try {
                  if (loader.store[state.id] !== undefined) await loader.remove(state.id)
                  await loader.await()
                } catch (error) {
                  if (loader.store[state.id] !== undefined) state.enabled = wasEnabled
                  throw error
                }
              })
            } finally {
              if (loader.store[state.id] === undefined) forgetMount(packageName, state)
            }
          })
        },
        hasEntry(packageName) {
          return mounts.has(packageName)
        },
        isEnabled(packageName) {
          return mounts.get(packageName)?.enabled === true
        },
        liveService(serviceName: string): object {
          const current: unknown = context.get(serviceName)
          if (typeof current !== 'object' || current === null) {
            throw new Error(`compat-dsh-runtime: Cordis service ${serviceName} is unavailable`)
          }
          return new Proxy(current, {
            get(_target, property) {
              const service: unknown = context.get(serviceName)
              if (typeof service !== 'object' || service === null) {
                throw new Error(`compat-dsh-runtime: Cordis service ${serviceName} is unavailable`)
              }
              const value: unknown = Reflect.get(service, property, service)
              if (typeof value === 'function' && property !== 'constructor') {
                const bound: unknown = value.bind(service)
                return bound
              }
              return value
            },
          })
        },
        registerLifecycleParticipant(participant) {
          if (disposed) throw new Error('compat-dsh-runtime: host is disposed')
          participants.add(participant)
          return () => { participants.delete(participant) }
        },
        forwardFsObserved(scope, target, observation, actor, forward) {
          if (activeObservations.some(active =>
            active.scope === scope && active.target === target && active.observation === observation && active.actor === actor)) return
          activeObservations.push({ scope, target, observation, actor })
          try { forward() } finally { activeObservations.pop() }
        },
      }
      native.own(async () => {
        disposed = true
        await operationTail
        const failures: unknown[] = []
        for (const [packageName, state] of [...mounts].reverse()) {
          try {
            if (loader.store[state.id] !== undefined) await loader.remove(state.id)
            Reflect.deleteProperty(loader.builtins, packageName)
            mounts.delete(packageName)
          } catch (error) { failures.push(error) }
        }
        try { await loader.await() } catch (error) { failures.push(error) }
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'compat-dsh-runtime: Loader teardown failed')
      })
      native.provide('compatDshRuntime', runtime)
    }
  },
}
