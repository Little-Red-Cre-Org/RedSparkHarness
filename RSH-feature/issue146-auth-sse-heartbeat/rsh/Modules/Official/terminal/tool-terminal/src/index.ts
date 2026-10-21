/**
 * Cordis compatibility facade for the persistent terminal tools.
 * @module @deepseek-ai/dsh-tool-terminal
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'

export { Config, DEFAULT_MAX_RESULT_BYTES, MIN_MAX_RESULT_BYTES } from './config.ts'

/** Cordis plugin name. */
export const name = 'tool-terminal'
/** Required terminal, tool, and prompt services. */
export const inject = ['terminals', 'tools', 'systemPrompt']

/** Load the Cordis implementation only when the compatibility plugin starts.
 * @param ctx - Cordis context that owns the registrations.
 * @param config - validated terminal-tool configuration.
 * @returns Resolves after the compatibility implementation has registered its tools.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
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
      '@deepseek-ai/dsh-tool-terminal could not load its Cordis compatibility entry. '
      + 'Install its optional @deepseek-ai/dsh-tools peer and ensure the package includes its compatibility chunk.',
      { cause },
    )
  }
  compatibility.apply(ctx, config)
}
