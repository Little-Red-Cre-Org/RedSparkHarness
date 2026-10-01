/**
 * Portable native plugin installation, scoped services, and owned teardown.
 * @module @deepseek-ai/dsh-native-runtime
 */

import type { NativeApplication } from './host.ts'

/** Extend from service Definition packages at the native-runtime package root. */
export interface NativeServices {
  /** The one application selected by a launched profile. */
  application: NativeApplication
}

/** Extend from event Definition packages at the native-runtime package root. */
export interface NativeEvents {}

export { RuntimeEvents } from './events.ts'
export type { EventDeclaration } from './events.ts'
export { NativeHost, resolveInstallation } from './host.ts'
export type { InstallationDiagnostic, InstallationPlan, InstallationRequest, NativeApplication, NativeContext, NativeInstallationId, NativeInvocation, NativePlugin } from './host.ts'
export { NativeScope } from './scope.ts'
export { NativeContributions } from './contributions.ts'
export type { Disposer, NativeScopeId } from './scope.ts'
export { parseNativeEntryManifest, validateNativePluginEntry } from './manifest.ts'
export type { NativeEntryManifest } from './manifest.ts'
