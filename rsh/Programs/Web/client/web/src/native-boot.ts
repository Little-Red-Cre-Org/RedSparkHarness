/** Native browser plugin composition over the host-authored module graph. */
import { dequal } from 'dequal'
import {
  NativeHost, NativeScope, resolveInstallation,
  type InstallationRequest, type NativePlugin,
} from '@deepseek-ai/dsh-native-runtime'

export type { NativeClientApplication, NativeClientRenderer } from '@deepseek-ai/dsh-client-ui-renderer/native'

/** Module import and installation states exposed to the native loading page. */
export type NativeClientEntryState = 'loading' | 'active' | 'failed'

/** Browser graph operations consumed by native installation. */
export interface NativeClientModuleSource {
  readonly manifest: { readonly modules: readonly { readonly id: string }[] }
  /** Import the selected package row through the served module graph. */
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
}

/** Host lifetime exposed to the browser shell. */
export interface NativeClientHost {
  /** Whole-composition cancellation; replacing one installation does not abort it. */
  readonly signal: AbortSignal
  /**
   * Validate the complete successor graph, drain changed installations and remount affected UI.
   * @param composition - served module graph and complete selected Client roster.
   * @returns replacement completion; import or resolution failures preserve the current UI.
   */
  replace(composition: Pick<NativeClientBootOptions, 'modules' | 'selections'>): Promise<void>
  /** Stop admission, unmount the UI, and await provider cleanup. */
  stop(): Promise<void>
  /** Observe installation state without exposing plugin configuration. */
  diagnostics(): readonly { readonly name: string; readonly state: string }[]
}

/** One explicitly selected native Client row with its profile configuration. */
export interface NativeClientSelection {
  readonly id: string
  /** Configuration retained for identity comparison; keep it immutable while installed. */
  readonly config: unknown
}

/** Host-injected browser module graph and selections for one Client composition. */
export interface NativeClientBootWire {
  readonly formatVersion: 1
  /** One ESM bundle containing every selected Client entry. */
  readonly bundle: string
  /** Stylesheets emitted while the Host bundled the selected entries. */
  readonly styles: readonly string[]
  /** Installation ids exported by `bundle.plugins`. */
  readonly modules: readonly { readonly id: string }[]
  readonly selections: readonly NativeClientSelection[]
  /** Host endpoint and content revision used for live Client replacement. */
  readonly reload?: { readonly endpoint: string; readonly revision: string }
}

/** Inputs for a browser composition; every selected id must be in the served graph. */
export interface NativeClientBootOptions {
  readonly modules: NativeClientModuleSource
  readonly selections: readonly NativeClientSelection[]
  readonly container: HTMLElement
  /** Skip activation after pending imports settle or stop the composition after it starts. */
  readonly signal?: AbortSignal
  /**
   * Report initial module import and completed installation without exposing plugin configuration.
   * Callback failure stops the composition.
   */
  readonly onEntryState?: (id: string, state: NativeClientEntryState) => void
}

function nativePlugin(value: unknown, id: string): NativePlugin {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`native client: ${id} must export a plugin object`)
  }
  const plugin = (value as { plugin?: unknown }).plugin
  if (plugin === null || typeof plugin !== 'object' || Array.isArray(plugin)) {
    throw new Error(`native client: ${id} has no native plugin export`)
  }
  const entry = plugin as Record<string, unknown>
  if (typeof entry.name !== 'string' || entry.name.length === 0
    || entry.apiVersion !== 1 || typeof entry.resolve !== 'function'
    || !Array.isArray(entry.targets) || !entry.targets.includes('client')
    || !Array.isArray(entry.requires) || !Array.isArray(entry.provides)
    || (entry.optional !== undefined && !Array.isArray(entry.optional))) {
    throw new Error(`native client: ${id} exports an invalid client plugin`)
  }
  return plugin as NativePlugin
}

/**
 * Import selected browser entries and install them in one native visibility scope.
 * @param options - module graph, selected entries, and renderer mount point.
 * @returns the active host; callers own and await `stop()` on navigation or shutdown.
 */
export async function bootNativeClient(options: NativeClientBootOptions): Promise<NativeClientHost> {
  const { container, signal } = options
  signal?.throwIfAborted()
  const scope = new NativeScope()
  const lifetime = new AbortController()
  const admission = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
  const prepare = async (
    { modules, selections }: Pick<NativeClientBootOptions, 'modules' | 'selections'>,
    previous: ReadonlyMap<string, InstallationRequest>,
    onEntryState?: NativeClientBootOptions['onEntryState'],
  ): Promise<Map<string, InstallationRequest>> => {
    admission.throwIfAborted()
    const graphIds = new Set(modules.manifest.modules.map(row => row.id))
    const seen = new Set<string>()
    for (const selection of selections) {
      if (!graphIds.has(selection.id)) throw new Error(`native client: ${selection.id} is absent from the boot graph`)
      if (seen.has(selection.id)) throw new Error(`native client: duplicate selection ${selection.id}`)
      seen.add(selection.id)
    }
    const requests = new Map<string, InstallationRequest>()
    for (const selection of selections) {
      admission.throwIfAborted()
      onEntryState?.(selection.id, 'loading')
      let plugin: NativePlugin
      try {
        const exports = await modules.import(selection.id, '', {})
        admission.throwIfAborted()
        plugin = nativePlugin(exports, selection.id)
      } catch (error) {
        onEntryState?.(selection.id, 'failed')
        throw error
      }
      const prior = previous.get(selection.id)
      requests.set(selection.id, prior !== undefined && prior.plugin === plugin && dequal(prior.config, selection.config)
        ? prior : { plugin, scope, config: selection.config })
    }
    return requests
  }
  let requests = await prepare(options, new Map(), options.onEntryState)
  admission.throwIfAborted()
  const mountPlugin: NativePlugin = {
    apiVersion: 1, name: 'native-client-mount', targets: ['client'],
    requires: ['clientApplication', 'clientRenderer'], provides: [],
    resolve: () => (context) => {
      const unmount = context.require('clientRenderer').mount(
        container,
        context.require('clientApplication'),
        context.signal,
      )
      context.own(unmount)
    },
  }
  const mount = { plugin: mountPlugin, scope, config: undefined }
  const runtime = new NativeHost(resolveInstallation([...requests.values(), mount], 'client'))
  let replacing = Promise.resolve()
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => {
    signal?.removeEventListener('abort', stopOnAbort)
    if (stopping !== undefined) return stopping
    const completion = Promise.withResolvers<void>()
    stopping = completion.promise
    lifetime.abort()
    void Promise.allSettled([runtime.stop(), replacing]).then(([cleanup]) => {
      if (cleanup.status === 'rejected') completion.reject(cleanup.reason)
      else completion.resolve()
    })
    return stopping
  }
  const stopOnAbort = (): void => { void stop().catch(() => undefined) }
  const startup = runtime.start()
  signal?.addEventListener('abort', stopOnAbort, { once: true })
  if (signal?.aborted) stopOnAbort()
  try {
    await startup
    if (signal?.aborted) {
      await stop()
      signal.throwIfAborted()
    }
    for (const selection of options.selections) options.onEntryState?.(selection.id, 'active')
  } catch (error) {
    await stop().catch(() => undefined)
    throw error
  }
  return {
    signal: AbortSignal.any([admission, runtime.signal]), stop, diagnostics: () => runtime.diagnostics(),
    replace: (composition) => {
      const operation = replacing.then(async () => {
        runtime.signal.throwIfAborted()
        const successor = await prepare(composition, requests)
        admission.throwIfAborted()
        await runtime.replace(resolveInstallation([...successor.values(), mount], 'client'))
        requests = successor
      })
      replacing = operation.catch(() => undefined)
      return operation
    },
  }
}
