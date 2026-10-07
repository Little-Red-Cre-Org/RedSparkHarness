import type { AgentLoopSettings } from './index.ts'
import { readSettingsOwner, type SettingsOwner } from './settings-owner.ts'
import type { AgentLoop } from './index.ts'

/** Operations the Cordis adapter needs to attach the current Settings source. */
export interface AgentLoopSettingsBinding {
  /** Composition entry used when the Settings provider is absent. */
  entry: AgentLoopSettings
  /** Attach a Settings value or restore the composition entry. */
  bindSource(source?: () => AgentLoopSettings): void
  /** Refuse a resolved value that the loop cannot use. */
  validate(value: AgentLoopSettings): void
}

/** Owner context and source binding reserved for the legacy Cordis face. */
export type AgentLoopSettingsOwner = SettingsOwner<AgentLoopSettingsBinding>

/**
 * Return the original owner and Settings hooks for one AgentLoop instance.
 * @param service - the AgentLoop whose legacy Settings hooks are requested.
 * @returns its original Cordis owner and private binding operations.
 */
export function agentLoopSettingsOwner(service: AgentLoop): AgentLoopSettingsOwner {
  return readSettingsOwner<AgentLoopSettingsBinding>(service)
}
