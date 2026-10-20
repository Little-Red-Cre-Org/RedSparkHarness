/** Installed native profile planning shared by CLI and the private Desktop Host. */
export {
  createNativePluginInventoryProvider, expandNativeProfilePresets, loadNativeProfile, nativeProfileChildProviderRoutes,
  nativeProfileChildRuntimeProviders, nativeProfileChildSupportInstallations, readNativeProfile, refuseLegacyPatch,
} from './native-profile-loader.ts'
export type {
  LoadedNativeProfile, NativeProfileAuxiliaryProvider, NativeProfileChildRouteProvider,
  NativeProfileChildSupportInstallation, NativeProfileServiceProvider,
} from './native-profile-loader.ts'
export { profileDirectoryRuntime, profileDirectoryReloadMode } from './native-profile-config.ts'
export type { NativeProfileConfig } from './native-profile-config.ts'
export { setCliPackageRoot, shippedNativeProfileClientComposition, shippedNativeProfileComposition } from './native-profile-template.ts'
export type { NativeProfileClientInstallation } from './native-profile-template.ts'
export { migrateNativeLegacyConfig, validateNativeLegacyConfig } from './native-legacy-config.ts'
