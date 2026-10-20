/**
 * Host a Cordis plugin inside a Native activation.
 *
 * A Cordis plugin is not a plain function: it registers through `ctx.effect()` and reaches
 * services by name through the context proxy, so it needs a live Cordis `Context` and an
 * active fiber. This module creates that context inside a Native activation and exposes the
 * Native services the plugin reads, translated to the Cordis shape it expects.
 *
 * The bridge deliberately hosts the Cordis *runtime*, not the legacy Desktop assembly: only
 * `@deepseek-ai/cordis` is involved, never the bundle and boot packages.
 *
 * @module @deepseek-ai/dsh-cordis-bridge
 */

import { Context } from '@deepseek-ai/cordis'
import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'

/** A Cordis plugin module as shipped: a name plus the function that installs it. */
export interface CordisPlugin {
  readonly name: string
  readonly apply: (ctx: never, config: never) => void | Promise<void>
  readonly inject?: readonly string[]
}

/** One bridged service: the object a Cordis plugin reads under `ctx.<name>`. */
export type BridgedServices = Readonly<Record<string, unknown>> | object

/** One Cordis plugin hosted by a Native activation. */
export interface BridgedPlugin {
  /** Cordis plugin to install. */
  readonly plugin: CordisPlugin
  /** Configuration handed to the plugin's `apply`. */
  readonly config?: unknown
  /** Services this plugin reads through the Cordis context. */
  readonly services: BridgedServices
}

/**
 * Install one Cordis plugin under a fresh Cordis context.
 *
 * The returned disposer tears the whole Cordis fiber down, which runs every `ctx.effect()`
 * the plugin registered in reverse order — including the bridged registrations, because each
 * one returns the Native disposer the plugin's effect owns.
 * @param bridged - plugin, its configuration, and the services it may read.
 * @returns completion after the plugin's effects have been disposed.
 */
export async function hostCordisPlugin(bridged: BridgedPlugin): Promise<() => Promise<void>> {
  const ctx = new Context()
  for (const [name, service] of Object.entries(bridged.services)) {
    ctx.provide(name as never, service as never)
  }
  await ctx.plugin(bridged.plugin as never, bridged.config as never)
  let disposed: Promise<void> | undefined
  return () => {
    disposed ??= ctx.fiber.dispose()
    return disposed
  }
}

/**
 * Wrap a Cordis plugin as a Native plugin.
 *
 * The Native activation owns the Cordis context: installing the row starts the plugin, and
 * removing it disposes the fiber, so a Cordis plugin participates in Native teardown exactly
 * like every other row.
 * @param name - Native installation name.
 * @param build - maps a Native activation to the bridged plugin it hosts.
 * @param requires - Native services the hosted plugin reads. Must match the package native manifest.
 * @returns a Native plugin that runs one Cordis plugin.
 */
export function nativePluginForCordis(
  name: string,
  build: (context: NativeContext, config: unknown) => BridgedPlugin,
  requires: NativePlugin['requires'] = [],
): NativePlugin {
  return {
    apiVersion: 1,
    name,
    targets: ['host'],
    requires: [...requires],
    provides: [],
    resolve(input) {
      return async (context) => {
        const dispose = await hostCordisPlugin(build(context, input))
        context.own(dispose)
      }
    },
  }
}
