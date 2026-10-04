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
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
      throw new Error('native-tools: configuration must be an object')
    }
    const fields = input as Record<string, unknown> | undefined
    if (Object.keys(fields ?? {}).some(key => key !== 'mode')) throw new Error('native-tools: unknown configuration field')
    const mode = fields?.mode === undefined ? 'both' : fields.mode
    if (mode !== 'native' && mode !== 'ptc' && mode !== 'both') throw new Error('native-tools: mode must be native, ptc or both')
    return (context) => {
      const registry = new NativeToolRegistry(context.require('agents'), context.scope, mode)
      context.own(() => registry.clear())
      context.provide('tools', registry)
    }
  },
}
