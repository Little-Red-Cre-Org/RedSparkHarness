/** Browser Connection Provider for native Client compositions. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createConnectionHandle, type ConnectionHandle } from './client/native-core.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Browser RPC and connection generation state for native Client Consumers. */
    clientConnection: ConnectionHandle
  }
}

/** Native Client Connection backed by the shared browser implementation. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: 'client-connection',
  targets: ['client'],
  requires: [],
  provides: ['clientConnection'],
  resolve: (config) => {
    if (config !== undefined && (config === null || typeof config !== 'object'
      || Array.isArray(config) || Object.keys(config).length > 0)) {
      throw new Error('client-connection: configuration must be an empty object')
    }
    return (context) => {
      const connection = createConnectionHandle()
      context.own(() => connection.dispose())
      context.provide('clientConnection', connection.handle)
    }
  },
}
