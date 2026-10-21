/** Native Host Provider for recorded model execution. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeModelExecution, type NativeModel } from './index.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    model: NativeModel
    modelExecution: NativeModelExecution
  }
}

/** Install one execution authority for the profile-selected model Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-model-execution', targets: ['host'],
  requires: ['model'], provides: ['modelExecution'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('native-model-execution: configuration must be empty')
    }
    return (context) => { context.provide('modelExecution', new NativeModelExecution(context.require('model'))) }
  },
}

export { NativeAdapterModel } from './index.ts'
