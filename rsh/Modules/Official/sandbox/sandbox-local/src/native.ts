/** Native process-sandbox Provider over the shared local runner backend. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
export type {} from '@redspark/rsh-sandbox/native'
import { LocalSandboxBackend, resolveConfig } from './backend.ts'

/** Install one scoped runner backend and revoke its temporary grants on removal. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-sandbox-local', targets: ['host'],
  requires: [], provides: ['sandbox'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const backend = new LocalSandboxBackend(config, (failures) => {
        throw new AggregateError(failures, 'sandbox-local: windows-acl grant cleanup failed')
      })
      context.own(() => { backend.dispose() })
      context.provide('sandbox', backend)
    }
  },
}
