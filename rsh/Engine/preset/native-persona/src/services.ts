/**
 * Native prompt-registry adapter for the persona row.
 *
 * @module @redspark/rsh-native-persona/services
 */

import type { NativeScope } from '@redspark/rsh-native-runtime'
import type { NativePromptRegistry } from '@redspark/rsh-native-prompt'
import {
  PERSONA_PREFIX_ORDER,
  PERSONA_PREFIX_SECTION,
  PERSONA_SUFFIX_ORDER,
  PERSONA_SUFFIX_SECTION,
} from '@redspark/rsh-native-prompt'
import type { PersonaPromptSections } from '@redspark/rsh-persona/native'

/**
 * Present a Native prompt registry to the shared persona row.
 *
 * A complete section replaces every other visible section. Runtime-context suppression is
 * recorded on the installation scope and removed with that Native row.
 * @param registry - the scope's Native prompt registry.
 * @param scope - preset scope that owns the sections. Omitted sections land on the registry root.
 * @returns the prompt operations the persona row reads.
 */
export function nativePromptSections(
  registry: NativePromptRegistry,
  scope?: NativeScope,
): PersonaPromptSections {
  return {
    prefixOrder: PERSONA_PREFIX_ORDER,
    suffixOrder: PERSONA_SUFFIX_ORDER,
    section: section => registry.register({
      name: section.name,
      order: section.order,
      text: () => section.text,
      ...(section.complete === true ? { complete: true } : {}),
    }, scope),
    suppressRuntimeContext: () => {
      return registry.suppressRuntimeContext(scope)
    },
  }
}

/** Section names a Native persona registers. */
export { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION }

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { promptSections: NativePromptRegistry }
}
