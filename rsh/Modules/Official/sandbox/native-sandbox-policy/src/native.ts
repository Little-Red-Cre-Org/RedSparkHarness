/** Native policy Provider selected explicitly by a profile. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeSandboxPolicy, resolveConfig } from './index.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sandboxPolicy: NativeSandboxPolicy }
}

/** One immutable policy per installation. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-sandbox-policy', targets: ['host'],
  requires: [], provides: ['sandboxPolicy'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => { context.provide('sandboxPolicy', new NativeSandboxPolicy(config)) }
  },
}
