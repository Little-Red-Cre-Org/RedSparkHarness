/**
 * Cordis compatibility facade for model-facing subagent delegation.
 * @module @deepseek-ai/dsh-tool-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Config } from './config.ts'

export { Config } from './config.ts'

/** Cordis plugin name. */
export const name = 'tool-subagent'
/** Required delegation, prompt, tool, and projection services. */
export const inject = ['tools', 'subagents', 'systemPrompt', 'sessionProjections']

/** Load the Cordis implementation only when the compatibility plugin starts.
 * @param ctx - Cordis context that owns the registrations.
 * @param config - validated delegation-tool configuration.
 * @param session - optional unpublished Session supplied by direct Agent setup.
 * @returns Resolves after the compatibility implementation has registered its listeners.
 */
export async function apply(ctx: Context, config: Config, session?: Session): Promise<void> {
  let compatibility: typeof import('./compat.ts')
  try {
    compatibility = await import('./compat.ts')
  } catch (cause: unknown) {
    if (
      typeof cause !== 'object'
      || cause === null
      || !('code' in cause)
      || cause.code !== 'ERR_MODULE_NOT_FOUND'
    ) throw cause
    throw new Error(
      '@deepseek-ai/dsh-tool-subagent could not load its Cordis compatibility entry. '
      + 'Install its optional Cordis compatibility peers and ensure the package includes its compatibility chunk.',
      { cause },
    )
  }
  compatibility.apply(ctx, config, session)
}
