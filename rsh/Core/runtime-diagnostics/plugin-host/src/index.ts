/**
 * RSH plugin-role registry and adapter over the owned Cordis runtime.
 * @module @deepseek-ai/dsh-plugin-host
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Fiber, Plugin, Inject } from '@deepseek-ai/cordis'

/** Runtime API revision implemented by this package. */
export const RSH_PLUGIN_API_VERSION = 1 as const

/** Roles a native RSH entry may have inside one capability domain. */
export type RshPluginRole = 'definition' | 'provider' | 'consumer' | 'policy' | 'projection' | 'adapter'

/** Static RSH ownership facts declared by a plugin package. */
export interface RshPluginDescriptor {
  /** Full npm package name that owns the entry. */
  readonly packageName: string
  /** Runtime API revision understood by this host. */
  readonly apiVersion: typeof RSH_PLUGIN_API_VERSION
  /** Role the plugin serves within its capability domain. */
  readonly role: RshPluginRole
  /** Stable capability domain, for example `filesystem`. */
  readonly capability: string
}

/** One active legacy Cordis plugin mounted through an RSH descriptor. */
export interface MountedRshPlugin {
  /** Descriptor registered before the Cordis plugin starts. */
  readonly descriptor: RshPluginDescriptor
  /** Cordis lifecycle owner for the adapted plugin. */
  readonly fiber: Fiber
  /** Dispose the Cordis fiber and release the descriptor reservation. */
  dispose(): Promise<void>
}

/** Cordis object-plugin form produced by {@link adaptCordisPlugin}. */
export interface CordisPluginAdapter {
  readonly name: string
  readonly Config?: NonNullable<Plugin.Base['Config']>
  readonly inject: Inject
  readonly provide?: string | string[]
  readonly intercept?: NonNullable<Plugin.Base['intercept']>
  readonly rsh: RshPluginDescriptor
  apply(ctx: Context, config: unknown): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginHost: RshPluginHost
  }
}

function assertDescriptor(descriptor: RshPluginDescriptor): void {
  if (descriptor.apiVersion !== RSH_PLUGIN_API_VERSION) {
    throw new Error(`plugin-host: ${descriptor.packageName} declares unsupported runtime API ${String(descriptor.apiVersion)}`)
  }
  if (descriptor.packageName.length === 0
    || descriptor.packageName.trim() !== descriptor.packageName
    || /\s/u.test(descriptor.packageName)) {
    throw new Error('plugin-host: descriptor packageName must be non-blank and contain no whitespace')
  }
  if (descriptor.capability.length === 0 || descriptor.capability.trim() !== descriptor.capability || /\s/u.test(descriptor.capability)) {
    throw new Error(`plugin-host: ${descriptor.packageName} declares an invalid capability`)
  }
  if (!['definition', 'provider', 'consumer', 'policy', 'projection', 'adapter'].includes(descriptor.role)) {
    throw new Error(`plugin-host: ${descriptor.packageName} declares an unsupported role ${String(descriptor.role)}`)
  }
}

/**
 * Owns declared RSH plugin identities and adapts legacy Cordis plugins without
 * replacing Cordis services, events, Loader configuration, or fiber lifecycle.
 */
export class RshPluginHost extends Service {
  private readonly descriptors = new Map<string, RshPluginDescriptor>()

  /** Install the registry as `ctx.pluginHost`. */
  constructor(ctx: Context) {
    super(ctx, 'pluginHost')
  }

  /**
   * Reserve a descriptor while its owner is mounted.
   * @param descriptor - declared RSH ownership facts.
   * @returns an idempotent disposer that releases the reservation.
   */
  register(descriptor: RshPluginDescriptor): () => void {
    assertDescriptor(descriptor)
    const current = this.descriptors.get(descriptor.packageName)
    if (current !== undefined) {
      throw new Error(`plugin-host: ${descriptor.packageName} is already registered as ${current.role} for ${current.capability}`)
    }
    this.descriptors.set(descriptor.packageName, descriptor)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.descriptors.delete(descriptor.packageName)
    }
  }

  /**
   * Return the current descriptor for one package.
   * @param packageName - full npm package name.
   * @returns the descriptor, or undefined when no owner is active.
   */
  get(packageName: string): RshPluginDescriptor | undefined {
    return this.descriptors.get(packageName)
  }

  /**
   * List active descriptors in stable package-name order.
   * @returns every descriptor currently reserved by a mounted adapter.
   */
  entries(): readonly RshPluginDescriptor[] {
    return [...this.descriptors.values()].sort((left, right) => left.packageName.localeCompare(right.packageName))
  }
}

function pluginName(plugin: Plugin, fallback: string): string {
  return plugin.name ?? fallback
}

function mergedInject(inject: Inject | undefined): Inject {
  if (inject === undefined) return ['pluginHost']
  if (Array.isArray(inject)) return [...new Set(['pluginHost', ...inject])]
  return { pluginHost: undefined, ...inject }
}

/**
 * Copy Cordis plugin metadata into the RSH object wrapper. This keeps config
 * validation, dependency activation, provider registration, and intercept
 * behavior owned by the original entry.
 * @param plugin - existing Cordis plugin entrypoint.
 * @param name - fallback Loader diagnostic name.
 * @returns metadata copied by the adapter.
 */
function pluginMetadata(plugin: Plugin, name: string): Pick<CordisPluginAdapter, 'name' | 'Config' | 'inject' | 'provide' | 'intercept'> {
  return {
    name: pluginName(plugin, name),
    ...(plugin.Config === undefined ? {} : { Config: plugin.Config }),
    inject: mergedInject(plugin.inject),
    ...(plugin.provide === undefined ? {} : { provide: plugin.provide }),
    ...(plugin.intercept === undefined ? {} : { intercept: plugin.intercept }),
  }
}

/**
 * Adapt an existing Cordis plugin for a Loader row without changing its public
 * configuration. The wrapper preserves the original Cordis metadata and awaits
 * the child Fiber, so child activation failure rejects the owning Loader entry.
 * @param descriptor - declared RSH role and capability identity.
 * @param plugin - existing Cordis plugin entrypoint.
 * @returns a Loader-compatible object plugin.
 */
export function adaptCordisPlugin(descriptor: RshPluginDescriptor, plugin: Plugin): CordisPluginAdapter {
  assertDescriptor(descriptor)
  const adapter: CordisPluginAdapter = {
    ...pluginMetadata(plugin, `rsh-adapter:${descriptor.packageName}`),
    rsh: descriptor,
    async apply(ctx: Context, config: unknown): Promise<void> {
      const host = ctx.pluginHost
      if (host === undefined) throw new Error(`plugin-host: ${descriptor.packageName} requires ctx.pluginHost`)
      const unregister = host.register(descriptor)
      try {
        const child = await ctx.plugin(plugin, config)
        ctx.effect(() => async () => {
          try {
            await child.dispose()
          } finally {
            unregister()
          }
        }, `plugin-host adapter ${descriptor.packageName}`)
      } catch (error) {
        unregister()
        throw error
      }
    },
  }
  return adapter
}

/**
 * Mount a current Cordis plugin through an RSH descriptor. The plugin still runs
 * in Cordis and its Fiber remains the single lifecycle authority.
 * @param ctx - Context that owns the adapted plugin.
 * @param descriptor - declared RSH role and capability identity.
 * @param plugin - existing Cordis plugin entrypoint.
 * @param config - plugin configuration passed unchanged to Cordis.
 * @returns the active fiber and a disposer that settles Cordis teardown first.
 */
export async function mountCordisPlugin(
  ctx: Context,
  descriptor: RshPluginDescriptor,
  plugin: Plugin,
  config?: unknown,
): Promise<MountedRshPlugin> {
  const host = ctx.pluginHost
  if (host === undefined) throw new Error(`plugin-host: ${descriptor.packageName} requires ctx.pluginHost`)
  const unregister = host.register(descriptor)
  let fiber: Fiber
  try {
    fiber = await ctx.plugin(plugin, config)
    fiber.ctx.effect(() => unregister, `plugin-host direct mount ${descriptor.packageName}`)
  } catch (error) {
    unregister()
    throw error
  }
  return {
    descriptor,
    fiber,
    dispose: () => fiber.dispose(),
  }
}

export default RshPluginHost
