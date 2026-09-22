/**
 * Portable native plugin installation, scoped services, and owned teardown.
 * @module @deepseek-ai/dsh-native-runtime
 */

export { RuntimeEvents } from './events.ts'
export type { EventDeclaration, NativeEvents } from './events.ts'
export { NativeHost, resolveInstallation } from './host.ts'
export type { InstallationDiagnostic, InstallationPlan, InstallationRequest, NativeContext, NativeInstallationId, NativeInvocation, NativePlugin, NativeServices } from './host.ts'
export { NativeScope } from './scope.ts'
export type { Disposer } from './scope.ts'
export { parseNativeEntryManifest, validateNativePluginEntry } from './manifest.ts'
export type { NativeEntryManifest } from './manifest.ts'
