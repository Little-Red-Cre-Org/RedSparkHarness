/** Explicit exceptions and Host packages for the published dependency policy. */

import {
  applicationDistributionDirectories,
  nativePackageDirectories,
  type ApplicationDistributionKind,
} from './native-package-policy.ts'

/** Packages treated as Client/Host packages without declaring `dsh.client`. */
const CLIENT_FACE_INCLUDE: readonly string[] = []

/** Packages exempted from automatic Client/Host treatment despite declaring `dsh.client`. */
const CLIENT_FACE_EXCLUDE: readonly string[] = [
  '@redspark/rsh-api-session-controller',
  '@redspark/rsh-api-workspace-controller',
]

/** Explicit Host packages whose published dependency edges need manual classification. */
const HOST_DEPENDENCY_PACKAGES: readonly string[] = [
  '@redspark/rsh-codex-app-server',
  '@redspark/rsh-llm',
  '@redspark/rsh-permission-presets',
  '@redspark/rsh-session',
  '@redspark/rsh-session-telemetry-otel',
  '@redspark/rsh-webhook',
]

/** Type imports retained by public declarations in independently installed packages. */
const PUBLISHED_TYPE_DEPENDENCIES = {
  '@redspark/rsh-codex-app-server': [
    '@redspark/rsh-llm',
    '@redspark/rsh-native-model-execution',
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-native-subagent',
    '@redspark/rsh-native-tools',
  ],
  '@redspark/rsh-client-ui-slots': ['@redspark/rsh-client-store', '@redspark/rsh-native-runtime', '@types/react'],
  '@redspark/rsh-client-modules': ['@redspark/rsh-http-routes'],
  '@redspark/rsh-client-web': ['@redspark/rsh-client-ui-slots'],
  '@redspark/rsh-llm': ['@redspark/rsh-attachment'],
  '@redspark/rsh-client-native-session': [
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-client-connection',
    '@redspark/rsh-native-model-selection',
    '@redspark/rsh-agent-presets',
    '@redspark/rsh-brand',
    '@redspark/rsh-commands',
    '@redspark/rsh-authorization',
    '@redspark/rsh-api-workspace-files',
    '@redspark/rsh-command-feedback',
    '@redspark/rsh-message-feedback',
  ],
  '@redspark/rsh-session-telemetry-otel': ['@opentelemetry/otlp-exporter-base'],
  '@redspark/rsh-client-native-application': [
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-client-native-session',
    '@redspark/rsh-native-tools',
  ],
  '@redspark/rsh-client-ui-conversation': ['@redspark/rsh-llm', '@redspark/rsh-attachment', '@redspark/rsh-client-ui-slots'],
  '@redspark/rsh-client-ui-tool': ['@redspark/rsh-client-ui-conversation', '@redspark/rsh-client-ui-slots'],
  '@redspark/rsh-client-ui-attachment': ['@redspark/rsh-attachment', '@types/react'],
  '@redspark/rsh-client-ui-goal': [
    '@redspark/rsh-session',
    '@types/react',
  ],
  '@redspark/rsh-client-ui-trajectory': [
    '@redspark/rsh-client-ui-conversation',
    '@redspark/rsh-client-ui-slots',
    '@redspark/rsh-session',
    '@types/react',
  ],
  '@redspark/rsh-client-locale': ['@redspark/rsh-client-ui-slots', '@redspark/rsh-native-runtime'],
  '@redspark/rsh-client-ui-session': [
    '@redspark/rsh-client-native-session',
    '@redspark/rsh-client-ui-slots',
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-session',
  ],
  '@redspark/rsh-client-ui-layout': [
    '@redspark/rsh-brand',
    '@redspark/rsh-client-store',
    '@redspark/rsh-client-ui-slots',
    '@redspark/rsh-native-runtime',
  ],
  '@redspark/rsh-client-ui-theme': ['@redspark/rsh-native-runtime'],
  '@redspark/rsh-client-ui-sidebar': [
    '@redspark/rsh-client-ui-layout',
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-workspace-definition',
  ],
  '@redspark/rsh-task-scheduler': [
    '@redspark/rsh-native-agent',
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-native-session-execution',
    '@redspark/rsh-typert-protocol',
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Published type imports whose provider must be installed by the consumer. */
const PUBLISHED_TYPE_PEER_DEPENDENCIES = {
  '@redspark/rsh-client-ui-user-questions': ['@redspark/rsh-user-questions'],
  '@redspark/rsh-client-ui-goal': ['@redspark/rsh-goal'],
  '@redspark/rsh-session-telemetry-otel': [
    '@redspark/rsh-launch-environment',
    '@redspark/rsh-native-runtime',
  ],
  '@redspark/rsh-session-log-export': [
    '@redspark/rsh-attachment',
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-session',
    '@redspark/rsh-session-persistence',
    '@redspark/rsh-session-query',
  ],
  '@redspark/rsh-permission-presets': [
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-native-session-execution',
    '@redspark/rsh-sandbox',
  ],
  '@redspark/rsh-session': ['@redspark/rsh-llm'],
  '@redspark/rsh-task-scheduler': ['@redspark/rsh-goal'],
  '@redspark/rsh-webhook': [
    '@redspark/rsh-agent-presets',
    '@redspark/rsh-native-model-execution',
    '@redspark/rsh-native-model-selection',
    '@redspark/rsh-native-runtime',
    '@redspark/rsh-native-session-execution',
    '@redspark/rsh-permission-presets',
    '@redspark/rsh-workspace',
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Peer packages that own contracts for Native services required by a mixed package's Host entry. */
const NATIVE_SERVICE_PEER_DEPENDENCIES = {
  '@redspark/rsh-session-log-export': {
    activeSessions: '@redspark/rsh-native-session-execution',
  },
  '@redspark/rsh-command-feedback': {
    activeSessions: '@redspark/rsh-native-session-execution',
  },
  '@redspark/rsh-message-feedback': {
    activeSessions: '@redspark/rsh-native-session-execution',
  },
  '@redspark/rsh-permission-presets': {
    agents: '@redspark/rsh-native-agent',
    sandboxPolicy: '@redspark/rsh-native-sandbox-policy',
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, string>>>>

/** Development-only package relationships not represented by source imports. */
const CONFIGURATION_ONLY_DEV_DEPENDENCIES = {
  '@redspark/rsh-client-locale': ['@redspark/rsh-api-remotes'],
  '@redspark/rsh-client-ui-conversation': [
    '@redspark/rsh-api-remotes',
    '@redspark/rsh-client-ui-workspace',
  ],
  '@redspark/rsh-client-ui-model-selection': ['@redspark/rsh-client-ui-input-trigger'],
  '@redspark/rsh-client-ui-sidebar': ['@redspark/rsh-client-ui-workspace'],
  '@redspark/rsh-client-ui-subagent': ['@redspark/rsh-client-ui-input-trigger'],
  '@redspark/rsh-client-ui-theme': ['@redspark/rsh-api-remotes'],
  '@redspark/rsh-client-ui-tool': ['@redspark/rsh-api-remotes'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Runtime dependencies retained by published Client packages. */
const CLIENT_RUNTIME_DEPENDENCIES = {
  '@redspark/rsh-client-ui-primitives': ['@shikijs/langs','anser','clsx','katex','mdast-util-from-markdown','mdast-util-gfm','mdast-util-math','micromark-core-commonmark','micromark-extension-gfm','micromark-extension-math','micromark-factory-space','micromark-util-character','micromark-util-classify-character','micromark-util-sanitize-uri','micromark-util-symbol','shiki'],
  '@redspark/rsh-client-store': ['immer', 'zustand'],
  '@redspark/rsh-client-web': ['@redspark/rsh-native-runtime', 'dequal'],
  '@redspark/rsh-client-native-session': ['eventsource-parser', 'zod', '@redspark/rsh-command-feedback'],
  '@redspark/rsh-client-ui-session': ['@redspark/rsh-util-workspace-path'],
  '@redspark/rsh-client-ui-renderer': ['use-sync-external-store'],
  '@redspark/rsh-client-ui-layout': ['@redspark/rsh-client-store'],
  '@redspark/rsh-client-native-application': ['@redspark/rsh-client-ui-primitives', '@redspark/rsh-client-ui-attachment', '@redspark/rsh-client-ui-goal', '@redspark/rsh-client-ui-trajectory', '@redspark/rsh-client-ui-workflow-run'],
  '@redspark/rsh-client-ui-attachment': ['clsx', 'react-dom'],
  '@redspark/rsh-client-ui-goal': ['@redspark/rsh-goal'],
  '@redspark/rsh-client-ui-trajectory': ['@tanstack/react-virtual', 'diff'],
  '@redspark/rsh-client-ui-sidebar': [
    'clsx',
    '@redspark/rsh-client-store',
    '@redspark/rsh-client-ui-primitives',
    '@redspark/rsh-client-ui-slots',
  ],
  '@redspark/rsh-client-ui-input-trigger': ['@redspark/rsh-file-reference'],
  '@redspark/rsh-client-ui-settings': ['@redspark/schemastery'],
  '@redspark/rsh-client-ui-settings-plugin-inventory': ['@redspark/rsh-brand'],
  '@redspark/rsh-client-file-upload': ['@redspark/rsh-util-crypto'],
  '@redspark/rsh-client-ui-open-in-app': [
    '@redspark/rsh-client-store',
    '@redspark/rsh-client-ui-primitives',
    '@redspark/rsh-host-open-in-app',
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Legacy Host peers omitted by the separately published native entry. */
export const OPTIONAL_NATIVE_HOST_PEERS: Readonly<Record<string, readonly string[]>> = {
  '@redspark/rsh-tool-pwsh': ['@redspark/rsh-tools'],
  '@redspark/rsh-tool-bash': ['@redspark/rsh-tools'],
  '@redspark/rsh-file-reference': ['@redspark/rsh-agent'],
  '@redspark/rsh-skill': ['@redspark/rsh-scope'],
  '@redspark/rsh-workflow': ['@redspark/rsh-agent'],
  '@redspark/rsh-fs-sandbox': ['@redspark/cordis', '@redspark/rsh-plugin-host', '@redspark/rsh-sandbox-policy'],
  '@redspark/rsh-session': ['@redspark/rsh-scope'],
  '@redspark/rsh-permission-presets': [
    '@redspark/rsh-compat-settings-definition',
    '@redspark/rsh-shell',
    '@redspark/rsh-commands',
    '@redspark/rsh-invariants',
    '@redspark/rsh-sandbox-policy',
    '@redspark/rsh-session',
    '@redspark/rsh-session-projection',
    '@redspark/rsh-user-approval',
  ],
  '@redspark/rsh-session-title': ['@redspark/rsh-agent', '@redspark/rsh-invariants'],
  '@redspark/rsh-compaction': ['@redspark/rsh-invariants'],
  '@redspark/rsh-session-reference': [
    '@redspark/rsh-agent',
    '@redspark/rsh-system-prompt',
    '@redspark/rsh-typert-protocol',
  ],
  '@redspark/rsh-command-feedback': ['@redspark/rsh-typert-protocol'],
  '@redspark/rsh-message-feedback': ['@redspark/rsh-typert-protocol'],
  '@redspark/rsh-authorization': ['@redspark/rsh-invariants'],
  '@redspark/rsh-llm': ['@redspark/rsh-typert-protocol'],
  '@redspark/rsh-webhook': [
    '@redspark/rsh-agent',
    '@redspark/rsh-agent-default-model',
    '@redspark/rsh-invariants',
  ],
  '@redspark/rsh-task-scheduler': ['@redspark/rsh-tools', '@redspark/rsh-typert-protocol'],
  '@redspark/rsh-tool-session-query': ['@redspark/rsh-tools'],
  '@redspark/rsh-web': ['@redspark/cordis'],
  '@redspark/rsh-web-fetch-http': ['@redspark/cordis'],
  '@redspark/rsh-web-search-deepseek': ['@redspark/cordis', '@redspark/rsh-agent', '@redspark/rsh-compat-settings-definition', '@redspark/rsh-session', '@redspark/rsh-native-tools', '@redspark/rsh-settings-definition'],
  '@redspark/rsh-web-search-exa': ['@redspark/cordis'],
  '@redspark/rsh-web-search-perplexity': ['@redspark/cordis'],
  '@redspark/rsh-tool-web': ['@redspark/cordis', '@redspark/rsh-system-prompt', '@redspark/rsh-tools'],
}

/** Client runtime peers whose values must resolve to the shared application instances. */
export const SHARED_CLIENT_RUNTIME_PEERS: Readonly<Record<string, readonly string[]>> = {
  '@redspark/rsh-client-ui-approval': ['react'],
  '@redspark/rsh-client-ui-user-questions': ['react'],
  '@redspark/rsh-client-ui-tool': ['react'],
  '@redspark/rsh-client-ui-attachment': ['react'],
  '@redspark/rsh-client-ui-goal': ['react'],
  '@redspark/rsh-client-ui-workflow-run': ['react'],
  '@redspark/rsh-client-ui-trajectory': ['react'],
  '@redspark/rsh-client-ui-primitives': ['react', 'react-dom'],
  '@redspark/rsh-client-ui-renderer': ['react', 'react-dom', '@redspark/rsh-client-ui-slots'],
  '@redspark/rsh-client-native-application': [
    'react',
    '@redspark/rsh-session',
    '@redspark/rsh-native-model-selection',
    '@redspark/rsh-client-native-session',
    '@redspark/rsh-client-ui-tool',
    '@redspark/rsh-client-ui-approval',
    '@redspark/rsh-client-ui-user-questions',
    '@redspark/rsh-tool-todo',
  ],
  '@redspark/rsh-client-native-session': ['@redspark/rsh-session'],
}

/** Workspace packages whose complete runtime surface is safe across duplicate installations. */
const DUPLICATE_SAFE_PACKAGES: readonly string[] = [
  '@redspark/rsh-brand',
  '@redspark/rsh-typert-protocol',
  '@redspark/rsh-util-crypto',
  '@redspark/rsh-util-values',
]

/**
 * Runtime exports whose values remain valid when npm installs another package copy.
 * New entries are forbidden by default. Automated agents must not add an
 * exception; every addition requires explicit human review and a dedicated,
 * prominent heading in the pull request description.
 */
const SAFE_HOST_DEPENDENCY_EXPORTS = {
  '@redspark/rsh-deque': ['Deque'],
  '@redspark/rsh-approval-definition': ['sessionApprovalPolicy'],
  '@redspark/rsh-approval-definition/legacy': ['APPROVAL_POLICIES', 'setApprovalPolicy'],
  '@redspark/rsh-commands/brand': ['CommandDefinitionId'],
  '@redspark/rsh-llm': ['boundContextSummary', 'errorChain'],
  '@redspark/rsh-llm/native': ['boundContextSummary'],
  '@redspark/rsh-json-rpc-line': ['JsonRpcLineTransport'],
  '@redspark/rsh-sandbox-policy': ['SANDBOX_MODES', 'setSandboxMode'],
  '@redspark/rsh-subprocess/native': ['disposeChildConnection'],
  '@redspark/rsh-session-format': ['sessionFormatLogFilename'],
  '@redspark/rsh-session/surface': ['isAppendSurfaceEvent'],
  '@redspark/rsh-timeout': ['MAX_TIMER_DELAY_MS'],
  '@redspark/schemastery': ['default'],
} as const satisfies HostDependencyExports

/** Runtime exports that require every consumer to resolve the provider's shared peer instance. */
const PEER_REQUIRED_HOST_EXPORTS = {
  '@redspark/rsh-goal/projection': ['foldGoal'],
  '@redspark/rsh-client-ui-primitives': [
    'Button', 'CodeBlock', 'DiffBlock', 'DisclosureRow', 'FileTypeIcon', 'IconApiOutline14', 'IconBrowseOutline16',
    'IconCheckOutline14', 'IconChevronDownOutline14', 'IconChevronLeftOutline14', 'IconChevronRightOutline14',
    'IconChevronUpOutline14', 'IconCloseFill14', 'IconCloseOutline16',
    'IconCodeOutline16', 'IconEditOutline16', 'IconGoalOutline16', 'IconInspectOutline12', 'IconSearchOutline16', 'IconSparkle16',
    'ReadBlock', 'SearchBlock', 'StateDot', 'TerminalBlock', 'WebBlock', 'diffTotals', 'fileExtension', 'fileSizeText',
    'IconSettingsOutline16', 'IconUserOutline16', 'JsonTree', 'MarkdownText', 'Tooltip', 'extractMarkdownPlainText',
    'Menu', 'Tag', 'LinkIcon', 'classifyLinkPath',
    'IconFolderOpenOutline16', 'IconRightUpOutline16', 'IconSkillOutline16',
  ],
  '@redspark/rsh-util-workspace-path': ['abbreviateHomePath','relativizeToCwd','resolveWorkspacePath'],
  '@redspark/rsh-spill-policy/notice': ['hasSpillNotice'],
  '@redspark/rsh-client-ui-conversation/conversation-copy': ['en','zh'],
  '@redspark/rsh-client-locale/dictionary': ['en','formatLocaleTemplate','zh'],
  '@redspark/rsh-errors': ['HarnessError', 'errorChain', 'isHarnessError'],
  '@redspark/rsh-llm': ['APP_IDENTITY', 'createUserMessage'],
  '@redspark/rsh-llm/native': ['APP_IDENTITY', 'createUserMessage', 'ReasoningEffortId', 'ToolCallId', 'fileHandleText'],
  '@redspark/rsh-anonymous-user-id': ['getOrCreateAnonymousUserId'],
  '@redspark/rsh-native-subagent/native': ['serializeNativeExternalJson'],
  '@redspark/rsh-scope': ['carrierKeyOf', 'scopeOf', 'scopeTarget'],
  '@redspark/rsh-session': ['Session', 'SessionId'],
  '@redspark/rsh-session-telemetry': ['SessionTelemetryBackend', 'SessionTelemetryCoordinator'],
  '@redspark/rsh-session-telemetry/records': ['isFeedbackEvent', 'ledgerRecord'],
  '@redspark/rsh-session/types': ['SESSION_FORMAT_VERSION'],
  '@redspark/rsh-session/native': ['SessionId'],
  '@redspark/rsh-session-persistence/native': ['SessionPersistenceNotFoundError'],
  '@redspark/rsh-session-title/normalize': ['normalizeSessionTitle'],
  '@redspark/rsh-tools': ['defineTool'],
} as const satisfies HostDependencyExports

/** Exact import specifier to reviewed runtime exports. */
type HostDependencyExports = Readonly<Record<string, readonly string[]>>

/** Complete configurable input to package dependency classification. */
export interface PackageDependencyPolicy {
  /** Package sources whose selected native entry does not require Cordis. */
  readonly cordisFreePackageDirectories: ReadonlySet<string>
  /** Application outputs governed by their own assembled runtime closure. */
  readonly applicationDistributionDirectories: ReadonlyMap<string, ApplicationDistributionKind>
  readonly clientFaceInclude: readonly string[]
  readonly clientFaceExclude: readonly string[]
  readonly hostPackages: readonly string[]
  readonly configurationOnlyDevDependencies: Readonly<Record<string, readonly string[]>>
  readonly clientRuntimeDependencies: Readonly<Record<string, readonly string[]>>
  readonly sharedClientRuntimePeers: Readonly<Record<string, readonly string[]>>
  readonly publishedTypeDependencies?: Readonly<Record<string, readonly string[]>>
  readonly publishedTypePeerDependencies?: Readonly<Record<string, readonly string[]>>
  readonly nativeServicePeerDependencies?: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly duplicateSafePackages?: readonly string[]
  readonly safeHostDependencyExports: HostDependencyExports
  readonly peerRequiredHostExports: HostDependencyExports
}

/** Repository dependency policy consumed by verification and benchmarking. */
export const PACKAGE_DEPENDENCY_POLICY: PackageDependencyPolicy = {
  cordisFreePackageDirectories: nativePackageDirectories,
  applicationDistributionDirectories,
  clientFaceInclude: CLIENT_FACE_INCLUDE,
  clientFaceExclude: CLIENT_FACE_EXCLUDE,
  hostPackages: HOST_DEPENDENCY_PACKAGES,
  configurationOnlyDevDependencies: CONFIGURATION_ONLY_DEV_DEPENDENCIES,
  clientRuntimeDependencies: CLIENT_RUNTIME_DEPENDENCIES,
  sharedClientRuntimePeers: SHARED_CLIENT_RUNTIME_PEERS,
  publishedTypeDependencies: PUBLISHED_TYPE_DEPENDENCIES,
  publishedTypePeerDependencies: PUBLISHED_TYPE_PEER_DEPENDENCIES,
  nativeServicePeerDependencies: NATIVE_SERVICE_PEER_DEPENDENCIES,
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
