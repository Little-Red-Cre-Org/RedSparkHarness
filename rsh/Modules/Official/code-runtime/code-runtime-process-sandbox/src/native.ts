/** Native Provider that confines code execution in a managed child process. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
export type {} from '@redspark/rsh-subprocess/native'
export type {} from '@redspark/rsh-sandbox/native'
export type {} from '@redspark/rsh-native-sandbox-policy/native'
export type {} from '@redspark/rsh-native-code-runtime/native'
import { resolveNativeWorkerThreadConfig } from '@redspark/rsh-native-code-runtime'
import { ProcessSandboxCodeRuntime } from './index.ts'

/** Install a code runtime only when process, confinement, and policy Providers are selected. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-code-runtime-process-sandbox', targets: ['host'],
  requires: ['subprocess', 'sandbox', 'sandboxPolicy'], provides: ['codeRuntime'],
  resolve(input) {
    const config = resolveNativeWorkerThreadConfig(input)
    return (context) => {
      const policy = context.require('sandboxPolicy')
      if (policy.defaultMode === 'danger-full-access') {
        throw new Error('code-runtime-process-sandbox: confined policy required')
      }
      const runtime = new ProcessSandboxCodeRuntime(
        context.require('subprocess'), context.require('sandbox'), policy, config,
      )
      context.own(() => runtime.dispose())
      context.provide('codeRuntime', runtime)
    }
  },
}
