/** Native registry Provider for profile-installed standing compositions. */
import schemastery from '@redspark/schemastery'
import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeAgentPresetRegistry } from './native-registry.ts'

import { PRESET_ID } from './preset.ts'
import { SETTINGS_NAMESPACE, type AgentPresetSettings } from './settings-namespace.ts'
import type { NativePresetFolderSummary } from './native-storage.ts'
import type { PresetRoot } from './preset.ts'
export type * from './native-definition.ts'
export type { AgentPresetSettings } from './settings-namespace.ts'
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

/**
 * The user-writable section; the resolver always receives it merged with the
 * registration base, so both fields are present by the time it is parsed.
 */
const settingsSectionSchema = z.strictObject({
  default: z.string(),
  modeSelectionEnabled: z.boolean(),
})

/**
 * The published schema the Native Settings page edits.
 *
 * `NativeSettings.describe` lists only registrations that carry a presentation,
 * and `mutate` refuses one that does not — so a namespace registered without
 * this is reachable by the document but invisible to the page.
 */
const PRESET_SELECTION_SCHEMA = schemastery.object({
  default: schemastery.string().default('standard'),
  modeSelectionEnabled: schemastery.boolean().default(true),
})

/**
 * Read a written settings section into the policy.
 *
 * The registration base supplies the defaults a stored document omits, so this
 * only has to reject what no base could make valid.
 * @param value - the merged section as stored.
 * @returns the resolved policy.
 */
function resolveSettings(value: Record<string, unknown>): AgentPresetSettings {
  return settingsSectionSchema.parse(value)
}

/**
 * Native registry Provider over the selected settings authority.
 *
 * The settings namespace is what makes the picker preference real: the Host
 * resolves every unnamed new Session through this policy, so a client that
 * writes `modeSelectionEnabled` hides the picker AND pins new Sessions to the
 * deployment default. Without a settings provider the registry still serves the
 * roster; the policy then reports the picker as shown and the deployment default
 * as effective.
 */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-agent-presets', targets: ['host'],
  requires: [], optional: ['settings'], provides: ['agentPresets'],
  resolve(input) {
    const config = resolveNativeAgentPresetsConfig(input)
    return (context) => {
      const settings = context.optional('settings')
      const base: AgentPresetSettings = { default: config.default, modeSelectionEnabled: true }
      const scope = settings?.register(SETTINGS_NAMESPACE, { ...base }, resolveSettings,
        undefined, { schema: PRESET_SELECTION_SCHEMA, applies: 'live' })
      if (scope !== undefined) context.own(() => { scope.dispose() })
      const registry = new NativeAgentPresetRegistry(
        config.default, context.scope, config.folders, config.managementRoots, scope,
      )
      context.own(() => registry.dispose())
      context.provide('agentPresets', registry)
    }
  },
}
