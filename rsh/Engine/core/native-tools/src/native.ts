/** Native tool registry Provider. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeToolRegistry } from './index.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { tools: NativeToolRegistry }
}

/** One scoped registry; plugin effects own its registered contributions. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-tools', targets: ['host'],
  requires: ['agents'], provides: ['tools'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('native-tools: configuration must be empty')
    }
    return (context) => {
      const registry = new NativeToolRegistry(context.require('agents'))
      context.own(() => { registry.clear() })
      context.provide('tools', registry)
    }
  },
}
