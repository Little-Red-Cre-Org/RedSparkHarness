/** Native Host Provider for the request-context contribution registry. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeRequestContextRegistry } from './index.ts'

/** Provide one scoped request-context registry for a Native Host realm. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-request-context',
  targets: ['host'],
  requires: [],
  provides: ['requestContexts'],
  resolve(input) {
    if (input !== undefined) throw new Error('request-context: this Provider accepts no configuration')
    return (context) => {
      const registry = new NativeRequestContextRegistry(context.scope)
      context.own(() => registry.dispose())
      context.provide('requestContexts', registry)
    }
  },
}
