/**
 * Deployment persona configuration for the Native prompt registry.
 *
 * The Cordis prompt registry composes the persona as two named sections so an
 * Agent preset can replace them by registering the same names. The Native
 * registry keeps those names and orders, so a composition that swaps a persona
 * behaves the same on either runtime.
 *
 * @module @redspark/rsh-native-prompt/config
 */

/**
 * The deployment persona prefix's section name, shared with the Cordis prompt
 * registry so a scoped section — an Agent preset replacing the deployment's
 * persona — shadows it rather than appearing beside it.
 */
export const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'

/** Deployment persona suffix section name shared by global and scoped contributions. */
export const PERSONA_SUFFIX_SECTION = 'deployment:persona-suffix'

/** Order of the deployment persona prefix; first-party guidance follows it. */
export const PERSONA_PREFIX_ORDER = 0

/** Order of the deployment persona suffix; it follows every other section. */
export const PERSONA_SUFFIX_ORDER = 10_200

/** Native prompt configuration: the deployment persona templates. */
export interface Config {
  /**
   * Deployment-wide persona prefix template. A scoped section named
   * {@link PERSONA_PREFIX_SECTION} shadows it; `{{variable}}` references are strict.
   */
  readonly personaPrefix?: string
  /**
   * Persona suffix template after first-party guidance. A scoped
   * {@link PERSONA_SUFFIX_SECTION} section shadows it.
   */
  readonly personaSuffix?: string
}

/**
 * Validate the persona configuration before the Provider activates.
 * @param input - profile configuration value; an absent value composes no persona.
 * @returns the validated templates, omitting the keys it did not receive.
 */
export function resolveConfig(input: unknown): Config {
  if (input === undefined) return {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('native-prompt: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'personaPrefix' && key !== 'personaSuffix') {
      throw new Error(`native-prompt: unsupported configuration field ${key}`)
    }
  }
  const prefix = fields.personaPrefix
  const suffix = fields.personaSuffix
  for (const [key, value] of [['personaPrefix', prefix], ['personaSuffix', suffix]] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new Error(`native-prompt: ${key} must be a non-empty string when present`)
    }
  }
  return {
    ...prefix === undefined ? {} : { personaPrefix: prefix as string },
    ...suffix === undefined ? {} : { personaSuffix: suffix as string },
  }
}
