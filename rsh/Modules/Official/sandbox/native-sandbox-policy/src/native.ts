/** Native policy Provider selected explicitly by a profile. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeSandboxPolicy, resolveConfig } from './index.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { sandboxPolicy: NativeSandboxPolicy }
}

/** One immutable policy per installation. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-native-sandbox-policy', targets: ['host'],
  requires: [], provides: ['sandboxPolicy'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => { context.provide('sandboxPolicy', new NativeSandboxPolicy(config)) }
  },
}
