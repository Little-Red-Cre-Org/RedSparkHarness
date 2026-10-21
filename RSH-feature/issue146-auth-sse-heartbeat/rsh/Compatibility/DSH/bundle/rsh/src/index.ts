/** Cordis entry for the RSH bundle's Ink terminal runtime. */
import type { Context } from '@deepseek-ai/cordis'
import { apply as mountTerminal } from './runtime.js'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Services required before mounting the terminal. */
export const inject = ['agentDefaultModel', 'agentPresets', 'agents', 'commands', 'llm', 'permissionPresets', 'sessions']

/**
 * Mount one terminal application under the profile's lifecycle.
 * @param ctx - owning plugin context with the launcher's exit request.
 */
export function apply(ctx: Context): void {
  mountTerminal(ctx)
}
