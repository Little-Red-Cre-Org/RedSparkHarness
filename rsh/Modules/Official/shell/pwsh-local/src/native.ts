/** Native local PowerShell Provider over managed subprocess execution. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { ShellOperations } from '@redspark/rsh-shell/native'
import type {} from '@redspark/rsh-subprocess/native'
import { LocalPwshController, resolveConfig } from './controller.ts'

export { LocalPwshController, resolveConfig, ENCODING_PREAMBLE } from './controller.ts'
export { resolvePwshPath } from './resolve.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { shell: ShellOperations }
}

/** Install PowerShell with validated budgets and a resolved executable. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-pwsh-local',
  targets: ['host'],
  requires: ['subprocess'],
  provides: ['shell'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      context.provide('shell', new LocalPwshController(context.require('subprocess'), () => config))
    }
  },
}
