/**
 * Schema reads and immutable draft edits for a Native Models page.
 *
 * The browser build receives ui-settings' Cordis `SettingsSchemaService`
 * through `ctx.settingsSchema`. A Native composition has no such service; the
 * settings domain base publishes the same operation set as
 * `clientNativeSettings.schema`. This module names that port so the page does
 * not import a service class, and so a composition without the settings domain
 * base is reported as a missing prerequisite instead of a crash.
 */

import type { SettingsSchemaOperations } from './client/schema-operations.ts'

/**
 * The settings domain base's Native schema port, narrowed to what this page calls.
 *
 * Declared structurally rather than imported: that package's Native half is a
 * separate installation whose service this composition selects, so importing
 * its source would make one package's build depend on another's entry.
 */
export interface NativeSettingsSchemaSource {
  /** Settings-owned schema reads and immutable path edits. */
  readonly schema: SettingsSchemaOperations
}

/**
 * Resolve the schema operations a Native Models page renders with.
 * @param settings - the selected `clientNativeSettings` service, when installed.
 * @returns the schema operations, or undefined when the composition installs no settings domain base.
 */
export function resolveNativeSchema(
  settings: NativeSettingsSchemaSource | undefined,
): SettingsSchemaOperations | undefined {
  return settings?.schema
}
