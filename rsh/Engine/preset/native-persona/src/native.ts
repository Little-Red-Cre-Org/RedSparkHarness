/** Native Host row hosting the shipped Cordis persona plugin. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { apply as applyPersona } from '@redspark/rsh-persona'
import { nativePluginForCordis } from '@redspark/rsh-cordis-bridge/native'
import { personaServices } from './services.ts'

/**
 * Provide one persona row by running the shipped Cordis plugin through the bridge.
 *
 * The row declares `promptSections` because the bridged plugin reads it; without that the
 * installation would plan against a Native service the preset may not mount.
 */
export const plugin: NativePlugin = nativePluginForCordis('@redspark/rsh-native-persona', (context, config) => ({
  plugin: { name: 'persona', apply: applyPersona },
  config,
  services: personaServices(context),
}), ['promptSections'])
