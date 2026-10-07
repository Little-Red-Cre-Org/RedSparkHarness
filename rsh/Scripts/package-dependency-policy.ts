/** Explicit exceptions and Host packages for the published dependency policy. */

import { nativePackageDirectories } from './native-package-policy.ts'

/** Packages treated as Client/Host packages without declaring `dsh.client`. */
const CLIENT_FACE_INCLUDE: readonly string[] = []

/** Packages exempted from automatic Client/Host treatment despite declaring `dsh.client`. */
const CLIENT_FACE_EXCLUDE: readonly string[] = [
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-workspace-controller',
]

/** Host-only packages whose peer relays are deliberately flattened. */
const HOST_DEPENDENCY_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
]

/** Type imports retained by public declarations in independently installed packages. */
const PUBLISHED_TYPE_DEPENDENCIES = {
  '@deepseek-ai/dsh-client-ui-slots': ['@deepseek-ai/dsh-client-store'],
  '@deepseek-ai/dsh-llm': ['@deepseek-ai/dsh-attachment'],
  '@deepseek-ai/dsh-client-native-session': [
    '@deepseek-ai/dsh-native-runtime',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-native-model-selection',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-brand',
  ],
  '@deepseek-ai/dsh-client-native-application': [
    '@deepseek-ai/dsh-native-runtime',
    '@deepseek-ai/dsh-client-native-session',
  ],
  '@deepseek-ai/dsh-client-ui-conversation': ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-attachment', '@deepseek-ai/dsh-client-ui-slots'],
  '@deepseek-ai/dsh-client-ui-tool': ['@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-slots'],
  '@deepseek-ai/dsh-client-locale': ['@deepseek-ai/dsh-client-ui-slots'],
  '@deepseek-ai/dsh-task-scheduler': [
    '@deepseek-ai/dsh-native-agent',
    '@deepseek-ai/dsh-native-runtime',
    '@deepseek-ai/dsh-native-session-execution',
    '@deepseek-ai/dsh-typert-protocol',
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Published type imports whose provider must be installed by the consumer. */
const PUBLISHED_TYPE_PEER_DEPENDENCIES = {
  '@deepseek-ai/dsh-session': ['@deepseek-ai/dsh-llm'],
  '@deepseek-ai/dsh-task-scheduler': ['@deepseek-ai/dsh-goal'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Development-only package relationships not represented by source imports. */
const CONFIGURATION_ONLY_DEV_DEPENDENCIES = {
  '@deepseek-ai/dsh-client-locale': ['@deepseek-ai/dsh-api-remotes'],
  '@deepseek-ai/dsh-client-ui-conversation': [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-workspace',
  ],
  '@deepseek-ai/dsh-client-ui-model-selection': ['@deepseek-ai/dsh-client-ui-input-trigger'],
  '@deepseek-ai/dsh-client-ui-sidebar': ['@deepseek-ai/dsh-client-ui-workspace'],
  '@deepseek-ai/dsh-client-ui-subagent': ['@deepseek-ai/dsh-client-ui-input-trigger'],
  '@deepseek-ai/dsh-client-ui-theme': ['@deepseek-ai/dsh-api-remotes'],
  '@deepseek-ai/dsh-client-ui-tool': ['@deepseek-ai/dsh-api-remotes'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Runtime dependencies retained by published Client packages. */
const CLIENT_RUNTIME_DEPENDENCIES = {
  '@deepseek-ai/dsh-client-ui-primitives': ['@shikijs/langs','anser','clsx','katex','mdast-util-from-markdown','mdast-util-gfm','mdast-util-math','micromark-core-commonmark','micromark-extension-gfm','micromark-extension-math','micromark-factory-space','micromark-util-character','micromark-util-classify-character','micromark-util-sanitize-uri','micromark-util-symbol','shiki'],
  '@deepseek-ai/dsh-client-store': ['immer', 'zustand'],
  '@deepseek-ai/dsh-client-web': ['@deepseek-ai/dsh-native-runtime', 'dequal'],
  '@deepseek-ai/dsh-client-native-session': ['eventsource-parser', 'zod'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Legacy Host peers omitted by the separately published native entry. */
export const OPTIONAL_NATIVE_HOST_PEERS: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/dsh-tool-pwsh': ['@deepseek-ai/dsh-tools'],
  '@deepseek-ai/dsh-workflow': ['@deepseek-ai/dsh-agent'],
  '@deepseek-ai/dsh-fs-sandbox': ['@deepseek-ai/cordis', '@deepseek-ai/dsh-plugin-host', '@deepseek-ai/dsh-sandbox-policy'],
  '@deepseek-ai/dsh-session': ['@deepseek-ai/dsh-scope'],
  '@deepseek-ai/dsh-llm': ['@deepseek-ai/dsh-typert-protocol'],
  '@deepseek-ai/dsh-task-scheduler': ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-typert-protocol'],
}

/** Client runtime peers whose values must resolve to the shared application instances. */
export const SHARED_CLIENT_RUNTIME_PEERS: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/dsh-client-ui-tool': ['react'],
  '@deepseek-ai/dsh-client-ui-primitives': ['react', 'react-dom'],
  '@deepseek-ai/dsh-client-ui-renderer': ['react', 'react-dom'],
  '@deepseek-ai/dsh-client-native-application': [
    'react',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-native-model-selection',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-client-native-session',
    '@deepseek-ai/dsh-client-ui-tool',
    '@deepseek-ai/dsh-tool-todo',
  ],
  '@deepseek-ai/dsh-client-native-session': ['@deepseek-ai/dsh-session'],
}

/** Workspace packages whose complete runtime surface is safe across duplicate installations. */
const DUPLICATE_SAFE_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-util-crypto',
  '@deepseek-ai/dsh-util-values',
]

/**
 * Runtime exports whose values remain valid when npm installs another package copy.
 * New entries are forbidden by default. Automated agents must not add an
 * exception; every addition requires explicit human review and a dedicated,
 * prominent heading in the pull request description.
 */
const SAFE_HOST_DEPENDENCY_EXPORTS = {
  '@deepseek-ai/dsh-deque': ['Deque'],
  '@deepseek-ai/dsh-session-format': ['sessionFormatLogFilename'],
  '@deepseek-ai/dsh-timeout': ['MAX_TIMER_DELAY_MS'],
  '@deepseek-ai/schemastery': ['default'],
} as const satisfies HostDependencyExports

/** Runtime exports that require every consumer to resolve the provider's shared peer instance. */
const PEER_REQUIRED_HOST_EXPORTS = {
  '@deepseek-ai/dsh-client-ui-primitives': ['CodeBlock','DiffBlock','DisclosureRow','IconApiOutline14','IconBrowseOutline16','IconCodeOutline16','IconEditOutline16','IconInspectOutline12','IconSearchOutline16','IconSparkle16','ReadBlock','SearchBlock','StateDot','TerminalBlock','WebBlock','diffTotals'],
  '@deepseek-ai/dsh-util-workspace-path': ['abbreviateHomePath','relativizeToCwd','resolveWorkspacePath'],
  '@deepseek-ai/dsh-spill-policy/notice': ['hasSpillNotice'],
  '@deepseek-ai/dsh-client-ui-conversation/conversation-copy': ['en','zh'],
  '@deepseek-ai/dsh-client-locale/dictionary': ['en','formatLocaleTemplate','zh'],
  '@deepseek-ai/dsh-client-ui-slots': ['SlotCore', 'SlotOwnershipError', 'StaleAuthorizationError', 'standardHookPropName'],
  '@deepseek-ai/dsh-errors': ['HarnessError', 'errorChain', 'isHarnessError'],
  '@deepseek-ai/dsh-llm': ['createUserMessage'],
  '@deepseek-ai/dsh-llm/native': ['createUserMessage', 'ReasoningEffortId'],
  '@deepseek-ai/dsh-scope': ['carrierKeyOf', 'scopeOf', 'scopeTarget'],
  '@deepseek-ai/dsh-session': ['SESSION_FORMAT_VERSION', 'SessionId'],
  '@deepseek-ai/dsh-session/native': ['SessionId'],
  '@deepseek-ai/dsh-session-persistence': ['SessionPersistenceNotFoundError'],
  '@deepseek-ai/dsh-tools': ['defineTool'],
} as const satisfies HostDependencyExports

/** Exact import specifier to reviewed runtime exports. */
type HostDependencyExports = Readonly<Record<string, readonly string[]>>

/** Complete configurable input to package dependency classification. */
export interface PackageDependencyPolicy {
  /** Package sources whose selected native entry does not require Cordis. */
  readonly cordisFreePackageDirectories: ReadonlySet<string>
  readonly clientFaceInclude: readonly string[]
  readonly clientFaceExclude: readonly string[]
  readonly hostPackages: readonly string[]
  readonly configurationOnlyDevDependencies: Readonly<Record<string, readonly string[]>>
  readonly clientRuntimeDependencies: Readonly<Record<string, readonly string[]>>
  readonly sharedClientRuntimePeers: Readonly<Record<string, readonly string[]>>
  readonly publishedTypeDependencies?: Readonly<Record<string, readonly string[]>>
  readonly publishedTypePeerDependencies?: Readonly<Record<string, readonly string[]>>
  readonly duplicateSafePackages?: readonly string[]
  readonly safeHostDependencyExports: HostDependencyExports
  readonly peerRequiredHostExports: HostDependencyExports
}

/** Repository dependency policy consumed by verification and benchmarking. */
export const PACKAGE_DEPENDENCY_POLICY: PackageDependencyPolicy = {
  cordisFreePackageDirectories: nativePackageDirectories,
  clientFaceInclude: CLIENT_FACE_INCLUDE,
  clientFaceExclude: CLIENT_FACE_EXCLUDE,
  hostPackages: HOST_DEPENDENCY_PACKAGES,
  configurationOnlyDevDependencies: CONFIGURATION_ONLY_DEV_DEPENDENCIES,
  clientRuntimeDependencies: CLIENT_RUNTIME_DEPENDENCIES,
  sharedClientRuntimePeers: SHARED_CLIENT_RUNTIME_PEERS,
  publishedTypeDependencies: PUBLISHED_TYPE_DEPENDENCIES,
  publishedTypePeerDependencies: PUBLISHED_TYPE_PEER_DEPENDENCIES,
  duplicateSafePackages: DUPLICATE_SAFE_PACKAGES,
  safeHostDependencyExports: SAFE_HOST_DEPENDENCY_EXPORTS,
  peerRequiredHostExports: PEER_REQUIRED_HOST_EXPORTS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a package manifest declares a dynamically loaded Client entry. */
export function hasClientDeclaration(dshField: unknown): boolean {
  return isRecord(dshField) && Object.hasOwn(dshField, 'client')
}

/** Whether the repository policy flattens one package's non-Cordis peers. */
export function usesFlattenedPackageDependencies(
  manifestPath: string,
  packageName: string,
  dshField: unknown,
  policy: PackageDependencyPolicy = PACKAGE_DEPENDENCY_POLICY,
): boolean {
  if (!manifestPath.startsWith('rsh/') || manifestPath.startsWith('rsh/Modules/Community/experimental/')) return false
  if (policy.hostPackages.includes(packageName)) return true
  if (manifestPath.startsWith('rsh/Programs/Web/client/')) return true
  const included = hasClientDeclaration(dshField) || policy.clientFaceInclude.includes(packageName)
  return included && !policy.clientFaceExclude.includes(packageName)
}
