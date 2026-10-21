/** Native local PowerShell Provider over managed subprocess execution. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ShellOperations } from '@deepseek-ai/dsh-shell/native'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import { LocalPwshController, resolveConfig } from './controller.ts'

export { LocalPwshController, resolveConfig, ENCODING_PREAMBLE } from './controller.ts'
export { resolvePwshPath } from './resolve.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { shell: ShellOperations }
}

/** Install PowerShell with validated budgets and a resolved executable. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-pwsh-local',
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
