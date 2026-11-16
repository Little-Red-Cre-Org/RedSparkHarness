/**
 * Cordis-free directory-picker capability used by Native host providers.
 * Interaction kinds match the service definition; this module imports no Cordis symbol.
 * @module @redspark/rsh-host-directory-picker/native-capability
 */

import type {} from '@redspark/rsh-native-runtime'
import type { DirectoryListing } from './types.ts'

/** One OS chooser on the host display. */
export interface NativeDirectoryPickerNativeCapability {
  /** Discriminator for the OS chooser. */
  readonly kind: 'native'
  /**
   * Open the chooser and wait for the operator.
   * @param signal - caller lifetime; abort terminates the chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  pick(signal: AbortSignal): Promise<string | null>
}

/** In-app listing and child creation. */
export interface NativeDirectoryPickerBrowseCapability {
  /** Discriminator for the browse interaction. */
  readonly kind: 'browse'
  /**
   * List one directory level.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort rejects with the abort reason.
   * @returns the level's listing.
   */
  list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create one child directory under an existing parent.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

/** Capability object a Native provider returns for the life of the installation. */
export type NativeDirectoryPickerCapability =
  | NativeDirectoryPickerNativeCapability
  | NativeDirectoryPickerBrowseCapability

/** Selected directory-picker interaction. The returned object stays stable. */
export interface NativeDirectoryPicker {
  /**
   * The interaction consumers switch on.
   * @returns the stable capability object.
   */
  capability(): NativeDirectoryPickerCapability
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    directoryPicker: NativeDirectoryPicker
  }
}
