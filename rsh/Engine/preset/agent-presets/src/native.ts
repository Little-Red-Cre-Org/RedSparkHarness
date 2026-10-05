/** Native registry Provider for profile-installed standing compositions. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentPresetRegistry } from './native-registry.ts'
export type * from './native-definition.ts'
export { NativeAgentPresetRegistry } from './native-registry.ts'
export { foldNativeAgentPresetFacts } from './selection.ts'

/** Fresh creation default; exact missing composition is refused when first resolved. */
export interface NativeAgentPresetsConfig { readonly default: string }

/**
 * Validate the deployment's fresh-session default.
 * @param input - profile configuration.
 * @returns validated explicit default.
 */
export function resolveNativeAgentPresetsConfig(input: unknown): NativeAgentPresetsConfig {
  return z.object({ default: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) }).strict().parse(input)
}

/** Registry only; the selected Program owns history, Agent creation and choice transactions. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-agent-presets', targets: ['host'], requires: [], provides: ['agentPresets'],
  resolve(input) {
    const config = resolveNativeAgentPresetsConfig(input)
    return (context) => {
      const registry = new NativeAgentPresetRegistry(config.default, context.scope)
      context.own(() => registry.dispose())
      context.provide('agentPresets', registry)
    }
  },
}
