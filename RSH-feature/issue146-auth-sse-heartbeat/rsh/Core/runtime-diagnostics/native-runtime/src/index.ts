/**
 * Portable native plugin installation, scoped services, and owned teardown.
 * @module @deepseek-ai/dsh-native-runtime
 */

import type { InstallationDiagnostic, NativeApplication, NativeInstallationId, NativePackageProvenance } from './host.ts'
import type { NativeScope, NativeScopeId } from './scope.ts'

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
  /**
   * Read ready package-backed installations visible from one exact scope.
   * @param scope - operation scope within this inventory Provider's realm.
   * @returns selected manifest identities from the scope and its ancestors.
   */
  packages(scope: NativeScope): readonly NativePackageInstallation[]
}

/** One selected package manifest tied to its exact Native installation and scope. */
export interface NativePackageInstallation {
  readonly id: NativeInstallationId
  readonly scope: NativeScopeId
  readonly package: NativePackageProvenance
}

/** Extend from event Definition packages at the native-runtime package root. */
export interface NativeEvents {}

export { RuntimeEvents } from './events.ts'
export type { EventDeclaration } from './events.ts'
export { NativeHost, resolveInstallation } from './host.ts'
export type { InstallationDiagnostic, InstallationPlan, InstallationRequest, NativeApplication, NativeContext, NativeInstallationId, NativeInvocation, NativePackageProvenance, NativePlugin } from './host.ts'
export { NativeScope, ResourceOwner } from './scope.ts'
export { NativeContributions } from './contributions.ts'
export type { Disposer, NativeScopeId } from './scope.ts'
export { parseNativeEntryManifest, validateNativePluginEntry } from './manifest.ts'
export type { NativeEntryManifest } from './manifest.ts'
