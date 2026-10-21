import type { SettingsService } from '@deepseek-ai/dsh-settings-definition'
import type { AgentDefaultModelSettings } from './index.ts'
import { readSettingsOwner, type SettingsOwner } from './settings-owner.ts'
import type { AgentDefaultModelConfig } from './index.ts'

/** Operations the Cordis adapter needs to attach the current Settings source. */
export interface AgentDefaultModelSettingsBinding {
  /** Composition entry used when the Settings provider is absent. */
  entry: AgentDefaultModelSettings
  /** Attach a Settings value, or restore the composition behavior. */
  bindSource(source?: () => AgentDefaultModelSettings): void
  /** Attach the active Settings writer, or clear it. */
  bindWriter(service?: SettingsService): void
}

/** Owner context and Settings hooks reserved for the legacy Cordis face. */
export type AgentDefaultModelSettingsOwner = SettingsOwner<AgentDefaultModelSettingsBinding>

/**
 * Return the original owner and Settings hooks for one model-selection service.
 * @param service - the config owner whose legacy Settings hooks are requested.
 * @returns its original Cordis owner and private binding operations.
 */
export function agentDefaultModelSettingsOwner(service: AgentDefaultModelConfig): AgentDefaultModelSettingsOwner {
  return readSettingsOwner<AgentDefaultModelSettingsBinding>(service)
}
