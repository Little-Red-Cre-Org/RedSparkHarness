import type { SubagentModelSelectionSettings } from './model-selection-settings.ts'
import { readSettingsOwner, type SettingsOwner } from './settings-owner.ts'
import type { SubagentModelSelectionConfig } from './model-selection-settings.ts'

/** Operations the Cordis adapter needs to attach the optional Settings source. */
export interface SubagentModelSelectionSettingsBinding {
  /** Composition entry used when the Settings provider is absent. */
  entry: SubagentModelSelectionSettings
  /** Attach a current Settings source or restore the composition entry. */
  bindSource(source?: () => SubagentModelSelectionSettings): void
  /** Refuse routes the subagent service cannot use. */
  validate(value: SubagentModelSelectionSettings): void
}

/** Original owner context and hooks reserved for the legacy Cordis face. */
export type SubagentModelSelectionSettingsOwner = SettingsOwner<SubagentModelSelectionSettingsBinding>

/**
 * Return the original owner and Settings hooks for one selection service.
 * @param service - the tool whose legacy Settings hooks are requested.
 * @returns its original Cordis owner and private binding operations.
 */
export function subagentModelSelectionSettingsOwner(
  service: SubagentModelSelectionConfig,
): SubagentModelSelectionSettingsOwner {
  return readSettingsOwner<SubagentModelSelectionSettingsBinding>(service)
}
