/** Explicit packages admitted to the Cordis-free native production graph. */

/** Source owners validated from both compiler faces by verify-native-dependencies. */
export const nativePackageDirectories: ReadonlySet<string> = new Set([
  'rsh/Core/runtime-diagnostics/native-runtime',
  'rsh/Core/util/brand',
  'rsh/Core/util/errors',
])

/** P4 native source owners checked before their P5 peer and artifact migration. */
export const transitionalNativeSourceDirectories: ReadonlySet<string> = new Set([
  'rsh/Core/util/json-rpc-line',
  'rsh/Core/util/native-command',
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
])

/** Mixed legacy packages whose ./native source closure is checked by the P4 gate. */
export const mixedNativeEntryDirectories: ReadonlyMap<string, string> = new Map([
  ['rsh/Modules/Official/credentials/credentials-local', 'Cordis service and native credential installer share the file backend'],
  ['rsh/Engine/session/session-persistence-jsonl', 'Cordis service and native storage entry share a package'],
  ['rsh/Modules/Official/fs/fs-local', 'Cordis filesystem Provider and native backend share a package'],
  ['rsh/Modules/Official/fs/fs-observation-policy', 'Cordis event policy and native entry share a package'],
])

/** Mixed library exports that have native values or types but no installer manifest. */
export const mixedNativeLibraryDirectories: ReadonlyMap<string, readonly ('host' | 'client')[]> = new Map([
  ['rsh/Core/util/launch-environment', ['host', 'client']],
  ['rsh/Modules/Official/credentials/credentials', ['host', 'client']],
])
