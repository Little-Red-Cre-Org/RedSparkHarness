/** Explicit Cordis-free source owners in the native production graph. */

/** Package sources validated from their selected compiler faces by verify-native-dependencies. */
export const nativePackageDirectories: ReadonlySet<string> = new Set([
  'rsh/Core/util/atomic-write',
  'rsh/Core/runtime-diagnostics/native-runtime',
  'rsh/Core/util/brand',
  'rsh/Core/util/crypto',
  'rsh/Core/util/errors',
  'rsh/Core/util/home-paths',
  'rsh/Core/util/json-rpc-line',
  'rsh/Core/util/native-command',
  'rsh/Core/util/output-retention',
  'rsh/Core/util/timeout',
  'rsh/Core/util/values',
  'rsh/Engine/session/session-format',
  'rsh/Engine/session/session-format-catalog',
  'rsh/Engine/session/session-format-v0-to-v1',
  'rsh/Engine/session/session-format-v1-to-v2',
  'rsh/Engine/session/session-format-v2-to-v3',
  'rsh/Engine/context/native-time-context',
  'rsh/Engine/core/native-agent',
  'rsh/Engine/core/native-code-runtime',
  'rsh/Engine/core/native-headless',
  'rsh/Engine/core/native-jobs',
  'rsh/Engine/core/native-model-execution',
  'rsh/Engine/core/native-prompt',
  'rsh/Engine/core/native-tools',
  'rsh/Engine/jobs/native-tool-jobs',
  'rsh/Modules/Official/interaction/native-approval',
  'rsh/Modules/Official/sandbox/native-sandbox-policy',
  'rsh/Programs/Web/host/native-web-host',
  'rsh/Programs/Web/host/native-web-assets',
  'rsh/Programs/Web/client/store',
  'rsh/Programs/Web/client/ui-slots',
])

/** Explicit compiler faces for pure packages with a Host-only implementation. */
export const nativePackageTargets: ReadonlyMap<string, readonly ('host' | 'client')[]> = new Map([
  ['rsh/Engine/core/native-tools', ['host']],
  ['rsh/Programs/Web/host/native-web-host', ['host']],
  ['rsh/Programs/Web/host/native-web-assets', ['host']],
])

/** Mixed legacy packages whose Cordis entry and native installer share a package. */
export const mixedNativeEntryDirectories: ReadonlyMap<string, string> = new Map([
  ['rsh/Programs/Web/client/ui-renderer', 'Cordis and native Client entries share slot rendering'],
  ['rsh/Programs/Web/client/connection', 'Cordis and native Client entries share authenticated transport'],
  ['rsh/Core/storage/storage', 'Cordis and native storage hubs share the backend registry'],
  ['rsh/Core/storage/storage-json', 'Cordis and native JSON Providers share atomic storage operations'],
  ['rsh/Core/storage/storage-domain', 'Cordis and native domain Providers share schemas and durability'],
  ['rsh/Modules/Official/credentials/credentials-local', 'Cordis service and native credential installer share the file backend'],
  ['rsh/Engine/session/session-persistence-jsonl', 'Cordis service and native storage entry share a package'],
  ['rsh/Modules/Official/fs/fs-local', 'Cordis filesystem Provider and native backend share a package'],
  ['rsh/Modules/Official/fs/fs-observation-policy', 'Cordis event policy and native entry share a package'],
])

/** Mixed library exports that have native values or types but no installer manifest. */
export const mixedNativeLibraryDirectories: ReadonlyMap<string, readonly ('host' | 'client')[]> = new Map([
  ['rsh/Modules/Official/fs/fs', ['host', 'client']],
  ['rsh/Engine/llm/llm', ['host', 'client']],
  ['rsh/Engine/core/session', ['host', 'client']],
  ['rsh/Engine/session/session-persistence', ['host', 'client']],
  ['rsh/Programs/Web/client/modules', ['client']],
  ['rsh/Programs/Web/client/web', ['client']],
  ['rsh/Core/util/launch-environment', ['host', 'client']],
  ['rsh/Modules/Official/credentials/credentials', ['host', 'client']],
])

/** Additional Cordis-free exports shared by mixed packages' native entries. */
export const nativeSafeSourceSubpaths: ReadonlyMap<string, readonly string[]> = new Map([
  ['rsh/Engine/core/native-tools', ['./types', './presentation']],
  ['rsh/Programs/Web/client/connection', ['./native-host', './native-http-bridge']],
  ['rsh/Programs/Web/host/native-web-assets', ['./native-client']],
  ['rsh/Core/storage/storage', ['./backend']],
  ['rsh/Modules/Official/attachment/attachment', ['./types']],
  ['rsh/Modules/Official/fs/fs', ['./operations', './types']],
  ['rsh/Modules/Official/sandbox/sandbox', ['./native-types']],
  ['rsh/Engine/core/session', ['./types']],
])

/** Additional native exports compiled only for the Host. */
export const nativeSafeSourceEntryTargets: ReadonlyMap<string, readonly ('host' | 'client')[]> = new Map([
  ['rsh/Engine/core/native-tools/types', ['host', 'client']],
  ['rsh/Engine/core/native-tools/presentation', ['host', 'client']],
  ['rsh/Programs/Web/client/connection/native-host', ['host']],
  ['rsh/Programs/Web/client/connection/native-http-bridge', ['host']],
  ['rsh/Programs/Web/host/native-web-assets/native-client', ['host']],
  ['rsh/Core/storage/storage/backend', ['host']],
])
