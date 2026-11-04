/**
 * The one service this package's Native entry requires from outside its own
 * closure: the settings domain base's Native half (ui-settings).
 *
 * That package publishes `clientNativeSettings` from its own Native entry.
 * Declaration merging requires both augmentations to name the same type, so
 * this module takes the service type from a fixed reference and never widens
 * it. The shape below is the subset this page calls; ui-settings' own
 * declaration is the authority and this file must be re-read whenever that one
 * changes.
 */

import type { SettingsSchemaOperations } from './client/schema-operations.ts'

/** Reference for the schema port this page reads from the settings domain base. */
export type { SettingsSchemaOperations }

/**
 * The settings domain base's Native service, as its own entry declares it.
 *
 * This page reads only {@link SettingsSchemaOperations}; the remaining members
 * exist because declaration merging compares whole declarations, and a
 * narrower type here would conflict with the provider's.
 */
export interface NativeSettingsServiceReference {
  /** Settings-owned schema reads and immutable path edits. */
  readonly schema: SettingsSchemaOperations
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Settings-namespace scopes and the schema port, published by ui-settings' Native entry. */
    clientNativeSettings: NativeSettingsServiceReference
  }
}
