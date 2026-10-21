/** Native sandboxing PowerShell Provider over managed subprocess execution. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import type {} from '@deepseek-ai/dsh-sandbox/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
export type {} from '@deepseek-ai/dsh-pwsh-local/native'
import { LocalPwshController, resolveConfig } from '@deepseek-ai/dsh-pwsh-local/native'
import { SandboxPwshController } from './controller.ts'

/** Install PowerShell only when the process, runner, and policy Providers are present. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-pwsh-sandbox',
  targets: ['host'],
  requires: ['subprocess', 'sandbox', 'sandboxPolicy'],
  provides: ['shell'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const local = new LocalPwshController(context.require('subprocess'), () => config,
        (proc, stderr, rejected, error) => { shell.onProcessDone(proc, stderr, rejected, error) })
      const shell = new SandboxPwshController(local, context.require('sandbox'), context.require('sandboxPolicy'))
      context.provide('shell', shell)
    }
  },
}
