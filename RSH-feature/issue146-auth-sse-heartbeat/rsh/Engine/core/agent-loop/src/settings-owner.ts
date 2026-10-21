import type { Context } from '@deepseek-ai/cordis'
import { requireSymbolValue, setSymbolValue } from '@deepseek-ai/dsh-util-values'

/** One engine service's private bridge to its legacy Settings adapter. */
export interface SettingsOwner<Binding> {
  /** Original Cordis context whose fiber owns the engine service. */
  owner: Context
  /** Framework-neutral settings inputs and source binding. */
  binding: Binding
}

const SETTINGS_OWNER = Symbol.for('@deepseek-ai/dsh-agent-loop/compat-settings-owner')

/**
 * Retain this service's original owner and private adapter operations.
 * @param service - the AgentLoop instance that owns this data.
 * @param owner - the Cordis context that owns the AgentLoop fiber.
 * @param binding - the private source and validation operations.
 */
export function retainSettingsOwner(service: object, owner: Context, binding: object): void {
  setSymbolValue(service, SETTINGS_OWNER, { owner, binding })
}

/**
 * Read the owner data exposed only from the legacy settings subpath.
 * @param service - the AgentLoop instance carrying the retained data.
 * @returns the original owner and its Settings binding.
 */
export function readSettingsOwner<Binding>(service: object): SettingsOwner<Binding> {
  return requireSymbolValue(service, SETTINGS_OWNER, 'agent-loop settings owner is unavailable') as SettingsOwner<Binding>
}
