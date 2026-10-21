import type { SettingsScope, SettingsService } from '@deepseek-ai/dsh-settings-definition'
import type { AgentPresetSettings } from './index.ts'
import { readSettingsOwner, type SettingsOwner } from './settings-owner.ts'
import type { AgentPresets } from './index.ts'

/** Settings binding operations reserved for the legacy Cordis face. */
export interface AgentPresetsSettingsBinding {
  /** Attach a registered scope or restore composition defaults. */
  bind(scope?: SettingsScope<AgentPresetSettings>, service?: SettingsService): void
}

/** Original owner context and Settings hooks for one preset roster. */
export type AgentPresetsSettingsOwner = SettingsOwner<AgentPresetsSettingsBinding>

/**
 * Return the original owner and Settings hooks for one preset roster.
 * @param service - the preset service whose legacy Settings hooks are requested.
 * @returns its original Cordis owner and private binding operations.
 */
export function agentPresetsSettingsOwner(service: AgentPresets): AgentPresetsSettingsOwner {
  return readSettingsOwner<AgentPresetsSettingsBinding>(service)
}
