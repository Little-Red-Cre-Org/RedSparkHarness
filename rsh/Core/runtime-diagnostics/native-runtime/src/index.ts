/**
 * Portable native plugin installation, scoped services, and owned teardown.
 * @module @deepseek-ai/dsh-native-runtime
 */

import type { InstallationDiagnostic, NativeApplication } from './host.ts'

/** Extend from service Definition packages at the native-runtime package root. */
export interface NativeServices {
  /** The one application selected by a launched profile. */
  application: NativeApplication
  /** Installation states of the running Host, provided by the profile loader. */
  pluginInventory: NativePluginInventory
}

/** Read-only view of the running Host's installations. */
export interface NativePluginInventory {
  /** @returns detached installation states in dependency order. */
  list(): readonly InstallationDiagnostic[]
}

/** Extend from event Definition packages at the native-runtime package root. */
export interface NativeEvents {}

export { RuntimeEvents } from './events.ts'
export type { EventDeclaration } from './events.ts'
export { NativeHost, resolveInstallation } from './host.ts'
export type { InstallationDiagnostic, InstallationPlan, InstallationRequest, NativeApplication, NativeContext, NativeInstallationId, NativeInvocation, NativePlugin } from './host.ts'
export { NativeScope, ResourceOwner } from './scope.ts'
export { NativeContributions } from './contributions.ts'
export type { Disposer, NativeScopeId } from './scope.ts'
export { parseNativeEntryManifest, validateNativePluginEntry } from './manifest.ts'
export type { NativeEntryManifest } from './manifest.ts'
