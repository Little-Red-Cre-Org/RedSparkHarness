/** Native Host row registering the persona prompt sections without a Cordis runtime. */
import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { applyPersonaSections } from '@redspark/rsh-persona/native'
import type { PersonaConfig } from '@redspark/rsh-persona/native'
import { nativePromptSections } from './services.ts'

/**
 * Validate a Native persona row.
 * @param input - untrusted profile fields.
 * @returns copied persona text and prompt behavior.
 */
export function resolveNativePersonaConfig(input: unknown): PersonaConfig {
  return z.object({
    prefix: z.string(),
    suffix: z.string().optional(),
    complete: z.boolean().optional(),
    includeRuntimeContext: z.boolean().optional(),
  }).strict().parse(input)
}

/** Host installer. The row requires the preset scope's prompt registry. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-native-persona',
  targets: ['host'],
  requires: ['promptSections'],
  provides: [],
  resolve(input) {
    const config = resolveNativePersonaConfig(input)
    return (context) => {
      applyPersonaSections(
        nativePromptSections(context.require('promptSections'), context.scope),
        config,
        register => context.effect(register()),
      )
    }
  },
}
