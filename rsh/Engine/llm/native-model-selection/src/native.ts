/** Native Session-local model intent Provider, independent of application transports. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-native-agent'
import type {} from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type {} from './definition.ts'
import { NativeModelSelectionService } from './service.ts'
export type * from './definition.ts'
export { NativeModelSelectionConflict } from './service.ts'

/** Install selection against exact active Session ownership and actual provider resolution. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-model-selection', targets: ['host'],
  requires: ['activeSessions', 'agents', 'modelDirectory'], provides: ['modelSelection'],
  resolve(input) {
    if (input !== undefined) throw new Error('native-model-selection: configuration is not supported')
    return (context) => {
      const service = new NativeModelSelectionService(context.require('activeSessions'), context.require('agents'),
        context.require('modelDirectory'), context.signal)
      context.own(() => service.dispose())
      context.provide('modelSelection', service)
    }
  },
}
