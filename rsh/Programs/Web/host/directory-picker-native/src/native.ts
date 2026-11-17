/**
 * Native host provider for the OS directory chooser.
 * @module @redspark/rsh-host-directory-picker-native/native
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeDirectoryPicker } from '@redspark/rsh-host-directory-picker/native-capability'
import { pickNativeDirectory } from './native-picker.ts'

const capability = {
  kind: 'native' as const,
  pick: pickNativeDirectory,
}

/**
 * Stable OS-chooser capability. `pick` opens the platform dialog.
 * @returns the native directory chooser.
 */
export function nativeDirectoryPicker(): NativeDirectoryPicker {
  return { capability: () => capability }
}

/**
 * Reject profile fields. The chooser has no working directory and no tunables.
 * @param input - untrusted profile fields.
 */
export function resolveNativeDirectoryPickerConfig(input: unknown): void {
  if (input === undefined) return
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0) {
    throw new Error('directory-picker-native: native provider accepts no configuration')
  }
}

/** Host plugin that provides `directoryPicker` with kind `native`. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-host-directory-picker-native',
  targets: ['host'],
  requires: [],
  optional: [],
  provides: ['directoryPicker'],
  resolve(input) {
    resolveNativeDirectoryPickerConfig(input)
    return (context) => {
      context.provide('directoryPicker', nativeDirectoryPicker())
    }
  },
}
