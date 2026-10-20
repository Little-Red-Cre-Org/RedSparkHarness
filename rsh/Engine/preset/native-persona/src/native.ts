/** Native Host row hosting the shipped Cordis persona plugin. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { apply as applyPersona } from '@deepseek-ai/dsh-persona'
import { nativePluginForCordis } from '@deepseek-ai/dsh-cordis-bridge/native'
import { personaServices } from './services.ts'

/**
 * Provide one persona row by running the shipped Cordis plugin through the bridge.
 *
 * The row declares `promptSections` because the bridged plugin reads it; without that the
 * installation would plan against a Native service the preset may not mount.
 */
export const plugin: NativePlugin = nativePluginForCordis('@deepseek-ai/dsh-native-persona', (context, config) => ({
  plugin: { name: 'persona', apply: applyPersona as never },
  config,
  services: personaServices(context),
}), ['promptSections'])
