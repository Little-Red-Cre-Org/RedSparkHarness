/** Native Host Provider wiring for the worker-thread code runtime. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeCodeRuntime } from './index.ts'
import { NativeWorkerThreadCodeRuntime, resolveNativeWorkerThreadConfig } from './worker-thread.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { codeRuntime: NativeCodeRuntime }
}

/** Native worker-thread code-runtime Provider with explicit validated budgets. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-code-runtime', targets: ['host'], requires: [], provides: ['codeRuntime'],
  resolve(input) {
    const config = resolveNativeWorkerThreadConfig(input)
    return (context) => {
      const runtime = new NativeWorkerThreadCodeRuntime(config)
      context.own(() => runtime.dispose())
      context.provide('codeRuntime', runtime)
    }
  },
}
