/** Native sandboxing Bash Provider over the shared command controller. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import type {} from '@deepseek-ai/dsh-sandbox/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
export type {} from '@deepseek-ai/dsh-bash-local/native'
import { LocalBashController, resolveConfig } from '@deepseek-ai/dsh-bash-local/native'
import { SandboxBashController } from './controller.ts'

/** Install a shell only when process, runner, and policy providers are present. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-bash-sandbox',
  targets: ['host'],
  requires: ['subprocess', 'sandbox', 'sandboxPolicy'],
  provides: ['shell'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const local = new LocalBashController(context.require('subprocess'), () => config,
        (proc, stderr, rejected, error) => { shell.onProcessDone(proc, stderr, rejected, error) })
      const shell = new SandboxBashController(local, context.require('sandbox'), context.require('sandboxPolicy'))
      context.provide('shell', shell)
    }
  },
}
