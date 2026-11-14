/** Native installer for the CPython subprocess code runtime. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-code-runtime-definition'
import { PythonProcessRuntime } from './runtime.ts'

/**
 * Install the experimental Python runtime as `codeRuntime`.
 * It requires no other Native service. A shipped profile does not select it.
 */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-experimental-code-runtime-python',
  targets: ['host'],
  requires: [],
  optional: [],
  provides: ['codeRuntime'],
  resolve(input) {
    const config = PythonProcessRuntime.Config(input ?? {})
    // oxlint-disable-next-line typescript/require-await -- async keeps a load-time config rejection a rejection, not a synchronous throw
    return async (context) => {
      const runtime = new PythonProcessRuntime(config, (teardown) => {
        context.own(teardown)
      })
      context.provide('codeRuntime', runtime)
    }
  },
}
