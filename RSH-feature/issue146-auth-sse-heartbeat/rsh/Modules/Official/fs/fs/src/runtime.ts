/** Loader adapter for filesystem plugins declared with RSH runtime roles. */

import type { Plugin } from '@deepseek-ai/cordis'
import { adaptCordisPlugin } from '@deepseek-ai/dsh-plugin-host'

/** One filesystem package's declared RSH role. */
export interface FilesystemPluginDescriptor {
  /** Full npm package name that owns this plugin. */
  readonly packageName: string
  /** Runtime API revision understood by the RSH plugin host. */
  readonly apiVersion: 1
  /** Role served by the filesystem plugin. */
  readonly role: 'definition' | 'provider' | 'consumer' | 'policy'
  /** Every plugin in this pilot belongs to the filesystem capability domain. */
  readonly capability: 'filesystem' | 'filesystem-discovery' | 'filesystem-delivery'
}

/**
 * Adapt a filesystem entry through the RSH role registry.
 * @param descriptor - declared role and capability identity.
 * @param plugin - existing Cordis plugin entrypoint.
 * @returns a Cordis entry carrying the RSH descriptor.
 */
export function adaptFilesystemPlugin(
  descriptor: FilesystemPluginDescriptor,
  plugin: Plugin,
): Plugin {
  return adaptCordisPlugin(descriptor, plugin)
}
