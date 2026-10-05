/** Native local Bash Provider over the shared managed subprocess controller. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ShellOperations } from '@deepseek-ai/dsh-shell/native'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import { LocalBashController, resolveConfig } from './controller.ts'

export { LocalBashController, resolveConfig } from './controller.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { shell: ShellOperations }
}

/** Install the local executor with fully resolved execution budgets. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-bash-local',
  targets: ['host'],
  requires: ['subprocess'],
  provides: ['shell'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      context.provide('shell', new LocalBashController(context.require('subprocess'), () => config))
    }
  },
}
