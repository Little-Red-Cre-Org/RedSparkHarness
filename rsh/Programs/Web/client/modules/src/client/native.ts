/** Cordis-free browser module table and boot-graph parser for native Client composition. */
export { ClientModuleSystem } from './system.ts'
export { exactPackageSpecifier, parseBootManifest, stripClientSuffix } from './manifest.ts'
export type {
  BootManifest, BootModuleRow, BootPluginRow, ClientBootstrapModule, ClientBundleRegistration,
  ClientModuleCreateOptions, ClientModuleLoader, ClientModuleLoaderTarget, ClientModuleRecord,
  ClientModuleSystemOptions, DshWindow, WebBootEntry, WebBootGraph,
} from './manifest.ts'
