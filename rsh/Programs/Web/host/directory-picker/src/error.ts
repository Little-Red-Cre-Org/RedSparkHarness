/**
 * Typed browse failure used by Cordis and Native directory-picker callers.
 * This module imports no Cordis symbol.
 * @module @redspark/rsh-host-directory-picker/error
 */

/** Closed failure codes of the browse primitives (mirrored onto the wire by consumers). */
export type DirectoryPickerErrorCode = 'directory-unreadable' | 'directory-exists' | 'directory-create-failed'

/** Typed failure thrown by browse primitives so consumers can map codes without string matching. */
export class DirectoryPickerError extends Error {
  /**
   * @param code - closed failure code.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: DirectoryPickerErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'DirectoryPickerError'
  }
}
