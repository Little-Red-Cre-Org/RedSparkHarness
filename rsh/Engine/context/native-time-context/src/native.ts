/** Native Host Provider for durable request-time context. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeTimeContext, resolveNativeTimeContextConfig } from './index.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { timeContext: NativeTimeContext }
}

/** Native request-time context Provider with explicit time-zone and refresh settings. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-time-context', targets: ['host'], requires: [], provides: ['timeContext'],
  resolve(input) {
    const config = resolveNativeTimeContextConfig(input)
    return (context) => { context.provide('timeContext', new NativeTimeContext(config)) }
  },
}
