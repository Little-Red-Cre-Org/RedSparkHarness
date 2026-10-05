/** Workspace manifest globs shared by repository discovery and validation gates. */

/** Published harness package manifests that replace the former two-level packages tree. */
export const RELEASE_MANIFEST_GLOBS = [
  'rsh/Core/identity/*/package.json',
  'rsh/Core/runtime-diagnostics/*/package.json',
  'rsh/Core/storage/*/package.json',
  'rsh/Core/subprocess/*/package.json',
  'rsh/Core/typert/*/package.json',
  'rsh/Core/util/*/package.json',
  'rsh/Engine/*/*/package.json',
  'rsh/Modules/Official/*/*/package.json',
  'rsh/Modules/Community/!(*experimental)/*/package.json',
  'rsh/Compatibility/DSH/*/*/package.json',
  'rsh/Programs/TUI/*/package.json',
  'rsh/Programs/ACP/packages/*/package.json',
  'rsh/Programs/SDK/packages/*/package.json',
  'rsh/Programs/Web/api/*/package.json',
  'rsh/Programs/Web/client/*/package.json',
  'rsh/Programs/Web/host/*/package.json',
  'rsh/Tests/test-support/*/package.json',
] as const

/** Published and experimental package manifests that own source and README contracts. */
export const PACKAGE_MANIFEST_GLOBS = [
  ...RELEASE_MANIFEST_GLOBS,
  'rsh/Modules/Community/experimental/*/package.json',
] as const

/** Source trees owned by workspace packages, excluding apps, fixtures, and vendored code. */
export const PACKAGE_SOURCE_GLOBS = [
  'rsh/Core/identity/*/src/**/*.ts',
  'rsh/Core/identity/*/src/**/*.tsx',
  'rsh/Core/runtime-diagnostics/*/src/**/*.ts',
  'rsh/Core/runtime-diagnostics/*/src/**/*.tsx',
  'rsh/Core/storage/*/src/**/*.ts',
  'rsh/Core/storage/*/src/**/*.tsx',
  'rsh/Core/subprocess/*/src/**/*.ts',
  'rsh/Core/subprocess/*/src/**/*.tsx',
  'rsh/Core/typert/*/src/**/*.ts',
  'rsh/Core/typert/*/src/**/*.tsx',
  'rsh/Core/util/*/src/**/*.ts',
  'rsh/Core/util/*/src/**/*.tsx',
  'rsh/Engine/*/*/src/**/*.ts',
  'rsh/Engine/*/*/src/**/*.tsx',
  'rsh/Modules/Official/*/*/src/**/*.ts',
  'rsh/Modules/Official/*/*/src/**/*.tsx',
  'rsh/Modules/Community/*/*/src/**/*.ts',
  'rsh/Modules/Community/*/*/src/**/*.tsx',
  'rsh/Compatibility/DSH/*/*/src/**/*.ts',
  'rsh/Compatibility/DSH/*/*/src/**/*.tsx',
  'rsh/Programs/TUI/*/src/**/*.ts',
  'rsh/Programs/TUI/*/src/**/*.tsx',
  'rsh/Programs/ACP/packages/*/src/**/*.ts',
  'rsh/Programs/ACP/packages/*/src/**/*.tsx',
  'rsh/Programs/SDK/packages/*/src/**/*.ts',
  'rsh/Programs/SDK/packages/*/src/**/*.tsx',
  'rsh/Programs/Web/api/*/src/**/*.ts',
  'rsh/Programs/Web/api/*/src/**/*.tsx',
  'rsh/Programs/Web/client/*/src/**/*.ts',
  'rsh/Programs/Web/client/*/src/**/*.tsx',
  'rsh/Programs/Web/host/*/src/**/*.ts',
  'rsh/Programs/Web/host/*/src/**/*.tsx',
  'rsh/Tests/test-support/*/src/**/*.ts',
  'rsh/Tests/test-support/*/src/**/*.tsx',
] as const

/** Every pnpm workspace manifest, including private applications and vendored sources. */
export const WORKSPACE_MANIFEST_GLOBS = [
  ...PACKAGE_MANIFEST_GLOBS,
  'rsh/Core/vendor/*/package.json',
  'rsh/Core/native/system/package.json',
  'rsh/Core/native/system/packages/*/package.json',
  'rsh/Programs/CLI/package.json',
  'rsh/Programs/Web/application/package.json',
  'rsh/Programs/Desktop/package.json',
  'rsh/Programs/DesktopHost/package.json',
  'rsh/Programs/SDK/python/sdk-runtime/package.json',
  'rsh/Tests/benchmarks/package.json',
  'rsh/Docs/website/package.json',
] as const
