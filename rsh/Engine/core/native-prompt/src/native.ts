/** Native system-prompt registry Provider. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { NativePromptRegistry } from './index.ts'
import {
  PERSONA_PREFIX_ORDER,
  PERSONA_PREFIX_SECTION,
  PERSONA_SUFFIX_ORDER,
  PERSONA_SUFFIX_SECTION,
  resolveConfig,
} from './config.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { promptSections: NativePromptRegistry }
}

/** Selected prompt registry for one native scope. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-native-prompt', targets: ['host'],
  requires: [], provides: ['promptSections'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const registry = new NativePromptRegistry(context.scope)
      context.own(() => { registry.clear() })
      // The deployment persona is a section, not a separate prompt channel: a scoped
      // Agent preset replaces it by registering the same name.
      if (config.personaPrefix !== undefined) {
        context.effect(registry.register({
          name: PERSONA_PREFIX_SECTION, order: PERSONA_PREFIX_ORDER, text: () => config.personaPrefix as string,
        }))
      }
      if (config.personaSuffix !== undefined) {
        context.effect(registry.register({
          name: PERSONA_SUFFIX_SECTION, order: PERSONA_SUFFIX_ORDER, text: () => config.personaSuffix as string,
        }))
      }
      context.provide('promptSections', registry)
    }
  },
}
