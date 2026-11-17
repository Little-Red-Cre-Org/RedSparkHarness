/**
 * A per-agent persona as a composable row.
 *
 * `dsh-system-prompt` owns the global persona as its own config, and registers
 * that section unconditionally — so this row is **scope-only**. Mounted inside
 * an agent preset it shadows the deployment persona for that one session,
 * exactly like the per-child persona `dsh-subagent` installs; mounted globally
 * it collides with the registry's own registration and fails loud.
 *
 * That constraint is the reason the row exists. An agent preset cannot mount
 * the prompt registry itself, so without a row of its own a preset could
 * change an agent's tools but never its identity.
 * @module @redspark/rsh-persona
 */

import type { Context } from '@redspark/cordis'
import z from '@redspark/schemastery'
import type {} from '@redspark/rsh-system-prompt'
import { applyPersonaSections } from './native.ts'

export { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@redspark/rsh-system-prompt'
export type { PersonaConfig } from './native.ts'

/** Cordis plugin name. */
export const name = 'persona'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona-prefix` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  prefix: string
  /**
   * Persona suffix template rendered after first-party guidance. Omitted or empty
   * text shadows the deployment suffix away; interpolation is strict.
   */
  suffix?: string
  /** Make the prefix the complete system prompt, suppressing the suffix and every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
}

/** Runtime schema for the persona row. */
export const Config: z<Config> = z.object({
  prefix: z.string().required(),
  suffix: z.string().default(''),
  complete: z.boolean().default(false),
  includeRuntimeContext: z.boolean().default(true),
})

/**
 * Register the persona prefix and suffix sections for the mounting context's scope.
 * @param ctx - an agent scope context; an unscoped context collides with the
 * prompt registry's own persona registration and rejects.
 * @param config - the prefix, suffix, and complete-prompt policy.
 */
export function apply(ctx: Context, config: Config): void {
  applyPersonaSections({
    section: section => ctx.systemPrompt.section(section),
    prefixOrder: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    suffixOrder: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    suppressRuntimeContext: () => ctx.systemPrompt.suppressRuntimeContext(),
  }, config, dispose => ctx.effect(dispose, 'persona.sections()'))
}
