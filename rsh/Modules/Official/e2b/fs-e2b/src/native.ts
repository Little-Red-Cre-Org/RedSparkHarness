/** Native host installer for the E2B filesystem backend. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-fs/native'
import type {} from '@redspark/rsh-e2b/native'
import { E2BFileSystemBackend } from './backend.ts'

/**
 * Reject a profile row. This provider has no configuration fields.
 * @param input - untrusted profile fields.
 */
export function resolveNativeE2BFilesystemConfig(input: unknown): void {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
    throw new Error('fs-e2b: native Provider accepts no configuration')
  }
}

/** Host installer. It requires the selected `e2b` service and provides `fs`. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-fs-e2b',
  targets: ['host'],
  requires: ['e2b'],
  provides: ['fs'],
  resolve(input) {
    resolveNativeE2BFilesystemConfig(input)
    return (context) => {
      context.provide('fs', new E2BFileSystemBackend(context.require('e2b')))
    }
  },
}
