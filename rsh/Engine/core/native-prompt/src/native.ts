/** Native system-prompt registry Provider. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativePromptRegistry } from './index.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { promptSections: NativePromptRegistry }
}

/** Selected prompt registry for one native scope. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-prompt', targets: ['host'],
  requires: [], provides: ['promptSections'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('native-prompt: configuration must be empty')
    }
    return (context) => {
      const registry = new NativePromptRegistry()
      context.own(() => { registry.clear() })
      context.provide('promptSections', registry)
    }
  },
}
