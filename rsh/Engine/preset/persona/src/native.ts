/** Shared persona section registration for the Cordis row and its Native installer. */

import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@redspark/rsh-system-prompt/sections'

export { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION }

/** Persona text and prompt behavior accepted by both runtime rows. */
export interface PersonaConfig {
  /** Persona prose rendered as the deployment prefix section. */
  readonly prefix: string
  /** Persona suffix rendered after first-party guidance. */
  readonly suffix?: string | undefined
  /** Make the prefix the complete system prompt. */
  readonly complete?: boolean | undefined
  /** Include dynamic runtime-context snapshots for the persona scope. */
  readonly includeRuntimeContext?: boolean | undefined
}

/** The prompt-registry operations a persona row needs. */
export interface PersonaPromptSections {
  /** Order the registry assigns to the deployment persona prefix. */
  readonly prefixOrder: number
  /** Order the registry assigns to the deployment persona suffix. */
  readonly suffixOrder: number
  /**
   * Register one prompt section.
   * @param section - section name, order, text, and complete-prompt policy.
   * @returns the exact section disposer.
   */
  section(section: {
    readonly name: string
    readonly order: number
    readonly text: string
    readonly complete?: boolean
  }): () => void
  /**
   * Suppress runtime-context snapshots for the persona scope.
   * @returns the exact suppression disposer.
   */
  suppressRuntimeContext(): () => void
}

/** Bind one registration and its disposer to the row's lifetime. */
export type PersonaEffect = (register: () => () => void) => unknown

/**
 * Register the persona prefix and suffix sections for one row.
 * @param prompt - prompt registry operations for the row's scope.
 * @param config - persona text and complete-prompt policy.
 * @param effect - binds each registration to the row's lifetime.
 */
export function applyPersonaSections(
  prompt: PersonaPromptSections,
  config: PersonaConfig,
  effect: PersonaEffect,
): void {
  effect(() => prompt.section({
    name: PERSONA_PREFIX_SECTION,
    order: prompt.prefixOrder,
    text: config.prefix,
    ...(config.complete === true ? { complete: true } : {}),
  }))
  effect(() => prompt.section({
    name: PERSONA_SUFFIX_SECTION,
    order: prompt.suffixOrder,
    text: config.suffix ?? '',
  }))
  if (config.includeRuntimeContext === false) effect(() => prompt.suppressRuntimeContext())
}
