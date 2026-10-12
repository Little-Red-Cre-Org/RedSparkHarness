/** Native registry Provider for profile-installed standing compositions. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentPresetRegistry } from './native-registry.ts'
import { PRESET_ID } from './preset.ts'
import type { NativePresetFolderSummary } from './native-storage.ts'
import type { PresetRoot } from './preset.ts'
export type * from './native-definition.ts'
export { NativeAgentPresetRegistry } from './native-registry.ts'
export { foldNativeAgentPresetFacts } from './selection.ts'
export { NativeAgentPresetError, NATIVE_COMPOSITION_FILE, nativePresetRoots, scanNativePresetFolders } from './native-storage.ts'
export type { NativePresetFolder, NativePresetFolderSummary, NativePresetInstallation } from './native-storage.ts'

/** Fresh creation default; exact missing composition is refused when first resolved. */
export interface NativeAgentPresetsConfig {
  /** Preset id used for fresh Sessions without a stored choice. */
  readonly default: string
  /** CLI-discovered folder summaries; profile authors do not provide these. */
  readonly folders?: readonly NativePresetFolderSummary[]
  /** Host-local roots used for live roster reads and folder management. */
  readonly managementRoots?: readonly PresetRoot[]
}

const configSchema = z.strictObject({
  default: z.string().regex(PRESET_ID),
  folders: z.array(z.strictObject({
    id: z.string().regex(PRESET_ID), name: z.string(), description: z.string().optional(),
    trust: z.enum(['system', 'user']), status: z.enum(['ready', 'needs-migration', 'invalid']),
    problem: z.string().optional(),
  })).optional(),
  managementRoots: z.array(z.strictObject({ path: z.string(), trust: z.enum(['system', 'user']) })).optional(),
})

/**
 * Validate the deployment's fresh-session default.
 * @param input - profile configuration.
 * @returns validated explicit default.
 */
export function resolveNativeAgentPresetsConfig(input: unknown): NativeAgentPresetsConfig {
  const config = configSchema.parse(input)
  return {
    default: config.default,
    ...config.folders === undefined ? {} : { folders: config.folders.map(({ id, name, description, trust, status, problem }) => ({
      id, name, trust, status,
      ...description === undefined ? {} : { description },
      ...problem === undefined ? {} : { problem },
    })) },
    ...config.managementRoots === undefined ? {} : { managementRoots: config.managementRoots },
  }
}

/** Registry only; the selected Program owns history, Agent creation and choice transactions. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-agent-presets', targets: ['host'], requires: [], provides: ['agentPresets'],
  resolve(input) {
    const config = resolveNativeAgentPresetsConfig(input)
    return (context) => {
      const registry = new NativeAgentPresetRegistry(config.default, context.scope, config.folders, config.managementRoots)
      context.own(() => registry.dispose())
      context.provide('agentPresets', registry)
    }
  },
}
