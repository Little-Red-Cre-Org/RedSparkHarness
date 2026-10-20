/**
 * Bridged services for the shipped Cordis rows a Native preset may host.
 *
 * Each builder translates the Native service a Cordis plugin reads into the Cordis shape that
 * plugin expects. Keeping the translations here — rather than in each plugin — is what lets an
 * unmodified shipped plugin run under either runtime.
 *
 * @module @deepseek-ai/dsh-native-persona/services
 */

import type { NativeContext, NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

/**
 * Order a persona prefix occupies, matching the Cordis system-prompt registry's own order for
 * the deployment persona row so a bridged preset renders where a native one would.
 */
const PREFIX_ORDER = 10_000
/** Order a persona suffix occupies, after the prefix and every first-party section. */
const SUFFIX_ORDER = 10_200

/** The Cordis `systemPrompt` service surface a persona row reads. */
export interface BridgedSystemPrompt {
  section(section: {
    readonly name: string
    readonly order: number
    readonly text: string
    readonly complete?: boolean
  }): () => void
  getSectionOrder(name: string): number
  suppressRuntimeContext(): void
}

/**
 * Present a Native prompt registry as the Cordis `systemPrompt` service.
 *
 * `complete` is not carried across: the Native registry has no whole-prompt takeover, so a
 * bridged persona contributes a section like any other. A preset that needs to replace the
 * entire prompt must use the Native persona row instead.
 * @param registry - the scope's Native prompt registry.
 * @param scope - preset scope that owns the sections. Omitted sections land on the registry root.
 * @returns the Cordis service a persona row reads.
 */
export function bridgedSystemPrompt(registry: NativePromptRegistry, scope?: NativeScope): BridgedSystemPrompt {
  return {
    section: section => registry.register({
      name: section.name,
      order: section.order,
      text: () => section.text,
    }, scope),
    getSectionOrder: name => name === 'DEPLOYMENT_PERSONA_PREFIX'
      ? PREFIX_ORDER
      : name === 'DEPLOYMENT_PERSONA_SUFFIX' ? SUFFIX_ORDER : PREFIX_ORDER,
    // The Native registry owns runtime-context suppression at the assembly level; a preset
    // cannot switch it per row, so a bridged persona records nothing here.
    suppressRuntimeContext: () => undefined,
  }
}

/** Section names a bridged persona registers. */
export { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION }

/** One bridged persona row: the services its Cordis plugin reads. */
export interface PersonaServices {
  readonly systemPrompt: BridgedSystemPrompt
}

/**
 * Build the services a Cordis persona row reads from one Native activation.
 * @param context - the Native activation hosting the row.
 * @returns the bridged service set.
 */
export function personaServices(context: NativeContext): PersonaServices {
  return { systemPrompt: bridgedSystemPrompt(context.require('promptSections'), context.scope) }
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { promptSections: NativePromptRegistry }
}
