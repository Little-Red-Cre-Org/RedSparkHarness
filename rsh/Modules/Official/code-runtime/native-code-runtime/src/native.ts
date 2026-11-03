/** Native Host Provider wiring for the worker-thread code runtime. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeWorkerThreadCodeRuntime, resolveNativeWorkerThreadConfig } from './worker-thread.ts'

/** Native worker-thread code-runtime Provider with explicit validated budgets. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-native-code-runtime', targets: ['host'], requires: [], provides: ['codeRuntime'],
  resolve(input) {
    const config = resolveNativeWorkerThreadConfig(input)
    return (context) => {
      const runtime = new NativeWorkerThreadCodeRuntime(config)
      context.own(() => runtime.dispose())
      context.provide('codeRuntime', runtime)
    }
  },
}
