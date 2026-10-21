import type { Context } from '@deepseek-ai/cordis'
import { requireSymbolValue, setSymbolValue } from '@deepseek-ai/dsh-util-values'

/** One engine service's private bridge to its legacy Settings adapter. */
export interface SettingsOwner<Binding> {
  /** Original Cordis context whose fiber owns the engine service. */
  owner: Context
  /** Framework-neutral settings inputs and source binding. */
  binding: Binding
}

const SETTINGS_OWNER = Symbol.for('@deepseek-ai/dsh-tool-subagent/compat-settings-owner')

/**
 * Retain this service's original owner and private adapter operations.
 * @param service - the model-selection tool that owns this data.
 * @param owner - the Cordis context that owns the service fiber.
 * @param binding - the private source and validation operations.
 */
export function retainSettingsOwner(service: object, owner: Context, binding: object): void {
  setSymbolValue(service, SETTINGS_OWNER, { owner, binding })
}

/**
 * Read the owner data exposed only from the legacy settings subpath.
 * @param service - the tool carrying the retained data.
 * @returns its original owner and Settings binding.
 */
export function readSettingsOwner<Binding>(service: object): SettingsOwner<Binding> {
  return requireSymbolValue(service, SETTINGS_OWNER, 'tool-subagent settings owner is unavailable') as SettingsOwner<Binding>
}
