/** Native browser plugin composition over the host-authored module graph. */
import {
  NativeHost, NativeScope, resolveInstallation,
  type InstallationRequest, type NativePlugin,
} from '@deepseek-ai/dsh-native-runtime'

/** Renderer capability supplied by a selected native Client plugin. */
export interface NativeClientRenderer {
  /**
   * Mount the application after all native Client providers activate.
   * @param container - Browser application mount point.
   * @param signal - Aborted when this installation stops.
   * @returns Optional unmount operation awaited before provider cleanup.
   */
  mount(container: HTMLElement, signal: AbortSignal): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
}

/** Browser graph operations consumed by native installation. */
export interface NativeClientModuleSource {
  readonly manifest: { readonly modules: readonly { readonly id: string }[] }
  /** Import the selected package row through the served module graph. */
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
}

/** Host lifetime exposed to the browser shell. */
export interface NativeClientHost {
  /** Stop admission, unmount the UI, and await provider cleanup. */
  stop(): Promise<void>
  /** Observe installation state without exposing plugin configuration. */
  diagnostics(): readonly { readonly name: string; readonly state: string }[]
}

/** One explicitly selected native Client row with its profile configuration. */
export interface NativeClientSelection {
  readonly id: string
  readonly config: unknown
}

/** Inputs for a browser composition; every selected id must be in the served graph. */
export interface NativeClientBootOptions {
  readonly modules: NativeClientModuleSource
  readonly selections: readonly NativeClientSelection[]
  readonly container: HTMLElement
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
  const { modules, selections, container } = options
  const graphIds = new Set(modules.manifest.modules.map(row => row.id))
  const seen = new Set<string>()
  for (const selection of selections) {
    if (!graphIds.has(selection.id)) throw new Error(`native client: ${selection.id} is absent from the boot graph`)
    if (seen.has(selection.id)) throw new Error(`native client: duplicate selection ${selection.id}`)
    seen.add(selection.id)
  }
  const scope = new NativeScope()
  const requests: InstallationRequest[] = []
  for (const selection of selections) {
    const exports = await modules.import(selection.id, '', {})
    requests.push({ plugin: nativePlugin(exports, selection.id), scope, config: selection.config })
  }
  const mountPlugin: NativePlugin = {
    apiVersion: 1, name: 'native-client-mount', targets: ['client'],
    requires: ['clientRenderer'], provides: [],
    resolve: () => async (context) => {
      const unmount = await context.require('clientRenderer').mount(container, context.signal)
      if (unmount !== undefined) context.own(unmount)
    },
  }
  requests.push({ plugin: mountPlugin, scope, config: undefined })
  const host = new NativeHost(resolveInstallation(requests, 'client'))
  await host.start()
  return host
}
