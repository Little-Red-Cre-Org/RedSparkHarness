/**
 * Workspace package invariant checks for package-manager-independent quality
 * gates.
 *
 * Run: `tsx rsh/Scripts/check-workspace-constraints.ts`.
 */

import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isPublicExperimentalPackageDirectory } from './experimental-package-policy.ts'
import { hasTypertRemoteNavigation, isForbiddenPublicationFile } from './publication-payload.ts'
import { collectProjectReferenceFaceViolations } from './project-reference-faces.ts'
import {
  applicationDistributionDirectories,
  mixedNativeEntryDirectories,
  mixedNativeLibraryDirectories,
  nativeCompatibilityOnlyPeers,
  nativePackageDirectories,
  nativeSafeSourceSubpaths,
} from './native-package-policy.ts'

const root = resolve(import.meta.dirname, '..', '..')
/** pnpm workspace manifests after the physical RSH migration. */
const WORKSPACE_MANIFEST_GLOB = 'rsh/**/package.json'
const NON_WORKSPACE_MANIFEST_PARTS = ['/tests/fixtures/', '/Programs/SDK/python/', '/Tests/benchmarks/']
const vendoredPackages = new Set([
  '@redspark/cordis',
  '@redspark/cosmokit',
  '@redspark/schemastery',
  '@redspark/cordis-plugin-loader',
  '@redspark/cordis-plugin-include',
  '@redspark/cordis-plugin-group',
  '@redspark/cordis-plugin-timer',
  '@redspark/cordis-plugin-hmr',
  '@redspark/cordis-plugin-logger-console',
])
const publicNativePackages = new Set([
  '@redspark/node-addon-system',
  '@redspark/node-addon-system-darwin-arm64',
  '@redspark/node-addon-system-darwin-x64',
  '@redspark/node-addon-system-linux-arm64',
  '@redspark/node-addon-system-linux-x64',
])
/** Deliberate source payloads whose exact bytes are part of the package's audit surface. */
const publicationSourceAllowlist: Readonly<Record<string, readonly string[]>> = {
  '@redspark/node-addon-system': ['src/main.c', 'src/flock.c'],
}
const repositoryUrl = 'git+https://github.com/redspark-harness/redspark-harness.git'
/**
 * Source home the published packages point consumers at. It differs from
 * {@link repositoryUrl}, which the Landlock packages keep because npm resolves
 * their trusted publishing against the repository that runs the workflow.
 *
 * This is the repository the code lives in, so it is the one a consumer should
 * be sent to. The manifests and this constant move together; a check that named
 * anywhere else would reject every package in the workspace.
 */
const publishedRepositoryUrl = 'git+https://github.com/Little-Red-Cre-Org/RedSparkHarness.git'
/** Packages that participate in the experimental policy. */
const experimentalPackageDirectory = /^rsh\/Modules\/Community\/experimental\/[^/]+$/
/** npm namespace reserved for experimental packages. */
const experimentalPackageNamePrefix = '@redspark/rsh-experimental-'
/** Ordinary directories whose packages this repository publishes: one release member each. */
const standardReleaseMemberDirectory = new RegExp('^(?:' + [
  'rsh/Core/vendor/[^/]+',
  'rsh/Core/(?!native/)[^/]+/[^/]+',
  'rsh/Engine/[^/]+/[^/]+',
  'rsh/Modules/Official/[^/]+/[^/]+',
  'rsh/Modules/Community/(?!experimental/)[^/]+/[^/]+',
  'rsh/Compatibility/DSH/[^/]+/[^/]+',
  'rsh/Programs/(?:TUI|ACP/packages|SDK/packages|Web/(?:api|client|host))/[^/]+',
  'rsh/Programs/(?:CLI|Web/application)',
  'rsh/Tests/test-support/[^/]+',
].join('|') + ')$')
/** Installable application assembled by electron-builder rather than published to npm. */
const desktopApplicationDirectory = 'rsh/Programs/Desktop'
/** Private compatibility assembly shipped only through the Desktop package set. */
const privateDesktopAssemblyDirectory = 'rsh/Compatibility/DSH/boot/desktop-host-compatibility'
const applicationPackageDirectories = new Set([
  'rsh/Programs/CLI',
  'rsh/Programs/Web/application',
  'rsh/Programs/DesktopHost',
])
const localArtifactDirs = new Set(['node_modules'])
const appPackageFiles: Readonly<Record<string, readonly string[]>> = {
  '@redspark/rsh': ['lib/*.js', 'lib/types/**/*.d.ts'],
  '@redspark/rsh-desktop-host': [
    'lib/*.js',
    'lib/types/**/*.d.ts',
  ],
  // Sourcemaps stay out by payload policy; worker preview remains a separate
  // private experimental surface.
  '@redspark/rsh-web-frontend': ['dist', '!dist/**/*.map'],
}

/** The subset of package.json fields this constraint check cares about. */
export interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  type?: string
  main?: string
  types?: string
  bin?: string | Record<string, string>
  exports?: Record<
    string,
    | string
    | {
      types?: string
      default?: string
    }
    | null
    | undefined
  >
  files?: string[]
  publishConfig?: { access?: string }
  repository?: { type?: string; url?: string; directory?: string }
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dsh?: {
    bundle?: {
      patch?: string
    }
    runtime?: {
      apiVersion?: unknown
      role?: unknown
      capability?: unknown
    }
  }
}

/** One workspace manifest and its repo-relative path. */
export interface WorkspaceManifest {
  dir: string
  manifest: PackageManifest
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

const rootManifest = readJson(join(root, 'package.json'))
const repositoryVersion = rootManifest.version
const nativeWorkspaceManifest = readJson(join(root, 'rsh/Core/native/system/package.json'))
const nativeVersion = nativeWorkspaceManifest.version

function workspaceManifests(): WorkspaceManifest[] {
  const manifests: WorkspaceManifest[] = [
    { dir: '.', manifest: rootManifest },
  ]

  for (const manifestPath of globSync(WORKSPACE_MANIFEST_GLOB, { cwd: root })) {
    const normalized = manifestPath.replaceAll('\\', '/')
    if (NON_WORKSPACE_MANIFEST_PARTS.some(part => normalized.includes(part))) continue
    const dir = relative(root, resolve(root, normalized.slice(0, -'/package.json'.length)))
      .replaceAll('\\', '/')
    manifests.push({ dir, manifest: readJson(join(root, dir, 'package.json')) })
  }

  return manifests
}

const packageFileExtras: Readonly<Record<string, readonly string[]>> = {
  '@redspark/rsh-desktop-host-compatibility': ['config/desktop.cordis.patch.yml'],
  '@redspark/rsh-approval-definition': ['lib/legacy.js'],
  '@redspark/rsh-command-feedback': ['lib/shared-*.js'],
  '@redspark/rsh-http-routes': ['lib/host.js', 'lib/shared-*.js'],
  '@redspark/rsh-webhook': ['lib/definition.js', 'lib/shared-*.js'],
  '@redspark/rsh-permission-presets': ['lib/native-definition.js', 'lib/shared-*.js'],
  '@redspark/rsh-commands': ['lib/shared-*.js'],
  '@redspark/rsh-goal': ['lib/projection.js', 'lib/shared-*.js'],
  '@redspark/rsh-goal-round-driver': ['lib/shared-*.js'],
  '@redspark/rsh-tool-goal': ['lib/shared-*.js'],
  '@redspark/rsh-command-goal': ['lib/shared-*.js'],
  '@redspark/rsh-codex-app-server': ['lib/wire.js', 'lib/shared-*.js'],
  '@redspark/rsh-subagent-claude-code': ['lib/shared-*.js'],
  '@redspark/rsh-llm-pi-ai': ['lib/shared-*.js'],
  '@redspark/rsh-llm-deepseek': ['lib/shared-*.js'],
  '@redspark/rsh-deepseek-llm-api-extensions': ['lib/shared-*.js'],
  '@redspark/rsh-plugin-package-inventory-deepseek': ['lib/shared-*.js'],
  '@redspark/rsh-session-log-deepseek': ['lib/shared-*.js'],
  '@redspark/rsh-session-telemetry': ['lib/records.js'],
  '@redspark/rsh-cordis-bridge': ['lib/types-*.js'],
  '@redspark/rsh-native-persona': ['lib/native-*.js', 'lib/types-*.js'],
  '@redspark/rsh-session-telemetry-otel': ['lib/shared-*.js'],
  '@redspark/rsh-skill': ['lib/shared.js'],
  '@redspark/rsh-skill-filesystem': ['lib/shared-*.js'],
  '@redspark/rsh-message-feedback': ['lib/shared-*.js'],
  '@redspark/rsh-archify': ['lib/shared-*.js'],
  '@redspark/rsh-request-context': ['lib/shared-*.js'],
  // Statically linked client libraries keep their stylesheets next to the emitted
  // JavaScript, which imports them by relative path: the compile shell runs
  // them through its own CSS pipeline, so the sheets are published artifacts.
  // The glob covers whichever sheets a package emits; sourcemaps stay
  // unpublished, as everywhere else in the repository.
  '@redspark/rsh-client-ui-tool': ['lib/tool-renderer.js', 'lib/**/*.css'],
  '@redspark/rsh-client-ui-approval': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-user-questions': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-conversation': ['lib/tool-records.js', 'lib/conversation-copy.js'],
  '@redspark/rsh-client-locale': ['lib/dictionary.js'],
  '@redspark/rsh-client-ui-primitives': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-dockkit': ['lib/**/*.css'],
  '@redspark/rsh-client-web': ['lib/boot-page.js', 'lib/**/*.css', 'lib/native-boot.js'],
  '@redspark/rsh-web-compatibility': ['dist', '!dist/**/*.map', '!dist/preview.html', '!dist/preview'],
  '@redspark/rsh-client-ui-theme': ['lib/theme-contract.js', 'lib/styles'],
  '@redspark/rsh-client-ui-sidebar-right': [
    'lib/native-ui.module.css',
    'lib/native-files.module.css',
  ],
  '@redspark/rsh-client-ui-sidebar': ['lib/client/SidebarRoot.module.css'],
  '@redspark/rsh-client-ui-layout': ['lib/client/AppFrame.module.css'],
  '@redspark/rsh-client-ui-attachment': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-goal': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-workflow-run': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-trajectory': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-message-feedback': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-skill': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-subagent': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-deliverables': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-plan': ['lib/client/PlanModeControl.module.css'],
  '@redspark/rsh-client-ui-schedule': ['lib/client/ScheduleCatalogAction.module.css'],
  // Direct native credential entries share backend bundles where necessary.
  '@redspark/rsh-web': ['lib/shared-*.js'],
  '@redspark/rsh-web-fetch-http': ['lib/shared-*.js'],
  '@redspark/rsh-web-search-deepseek': ['lib/shared-*.js'],
  '@redspark/rsh-web-search-exa': ['lib/shared-*.js'],
  '@redspark/rsh-web-search-perplexity': ['lib/shared-*.js'],
  '@redspark/rsh-tool-web': ['lib/shared-*.js'],
  '@redspark/rsh-credentials': ['lib/shared-*.js'],
  '@redspark/rsh-authorization': ['lib/shared-*.js'],
  '@redspark/rsh-credentials-local': ['lib/backend.js', 'lib/shared-*.js'],
  '@redspark/rsh-deepseek-account': ['lib/shared-*.js'],
  '@redspark/rsh-task-scheduler': ['lib/shared-*.js'],
  '@redspark/rsh-agent-loop': ['lib/compat-settings.js', 'lib/settings-owner-*.js'],
  '@redspark/rsh-agent-default-model': ['lib/compat-settings.js', 'lib/settings-owner-*.js'],
  '@redspark/rsh-agent-presets': [
    'presets', 'lib/selection.js', 'lib/compat-settings.js',
    'lib/settings-owner-*.js', 'lib/shared-*.js',
  ],
  '@redspark/rsh-tool-subagent': [
    'lib/model-selection-settings.js', 'lib/compat-settings.js', 'lib/shared-*.js',
  ],
  '@redspark/rsh-compat-settings-adapters': [
    'lib/agent-loop.js', 'lib/agent-default-model.js', 'lib/agent-presets.js', 'lib/tool-subagent.js',
    'lib/settings-entry-*.js',
  ],
  '@redspark/rsh-settings': ['lib/shared-*.js'],
  '@redspark/rsh-compat-settings-definition': ['lib/events.js'],
  '@redspark/rsh-settings-file': ['lib/shared-*.js'],
  '@redspark/rsh-subprocess': ['lib/shared-*.js'],
  '@redspark/rsh-storage': ['lib/shared-*.js'],
  '@redspark/rsh-storage-json': ['lib/shared-*.js'],
  '@redspark/rsh-storage-domain': ['lib/shared-*.js'],
  '@redspark/rsh-launch-environment': ['lib/layers.js', 'lib/shared-*.js'],
  '@redspark/rsh-mcp-client': ['lib/types.js', 'lib/acp-config.js', 'lib/shared-*.js'],
  // The CPython side ships as source .py files, published as-is rather than built.
  '@redspark/rsh-experimental-code-runtime-python': ['py/**/*.py'],
  // The shipped preset compositions travel inside the roster package.
  '@redspark/rsh-agent-preset-standing': ['lib/shared-*.js'],
  '@redspark/rsh-plan-mode': ['lib/shared-*.js'],
  '@redspark/rsh-session-title': ['lib/shared-*.js'],
  '@redspark/rsh-session-title-llm': ['lib/shared-*.js'],
  '@redspark/rsh-session-title-first-prompt-llm': ['lib/shared-*.js'],
  '@redspark/rsh-session-title-all-prompts-llm': ['lib/shared-*.js'],
  '@redspark/rsh-tool-todo': ['lib/shared-*.js', 'lib/client-native.js'],
  '@redspark/rsh-workspace': ['lib/shared-*.js'],
  // The terminal bundle's entry and runtime export share a generated chunk.
  '@redspark/rsh-native-tui': ['lib/shared-*.js'],
  '@redspark/rsh-terminal-ui': ['lib/presentation.js', 'lib/utilities.js', 'lib/shared-*.js'],
  '@redspark/rsh-rsh': ['lib/runtime.js', 'lib/runtime-*.js'],
  // Native filesystem entries share their storage and error implementations
  // across the legacy root and direct native package exports.
  '@redspark/rsh-fs': [
    'lib/runtime.js', 'lib/operations.js', 'lib/types.js', 'lib/shared-*.js',
  ],
  '@redspark/rsh-fs-local': [
    'lib/backend.js', 'lib/shared-*.js',
  ],
  '@redspark/rsh-fs-sandbox': ['lib/shared-*.js', 'lib/types-*.js'],
  '@redspark/rsh-sandbox': ['lib/native-types.js', 'lib/roots.js', 'lib/shared-*.js'],
  '@redspark/rsh-sandbox-local': ['lib/shared-*.js'],
  '@redspark/rsh-user-questions': ['lib/protocol.js', 'lib/broker.js', 'lib/shared-*.js'],
  '@redspark/rsh-tool-ask-user': ['lib/shared-*.js'],
  '@redspark/rsh-fs-observation-policy': ['lib/shared-*.js'],
  '@redspark/rsh-tool-fs-search': ['lib/shared-*.js'],
  '@redspark/rsh-subagent-protocol': ['lib/descriptor.js', 'lib/assistant-output.js', 'lib/shared-*.js'],
  '@redspark/rsh-acp-protocol': ['lib/shared-*.js'],
  '@redspark/rsh-acp-child': ['lib/shared-*.js'],
  '@redspark/rsh-spill': ['lib/shared-*.js'],
  '@redspark/rsh-spill-local': ['lib/shared-*.js'],
  '@redspark/rsh-tool-fs': ['lib/read-image-core.js', 'lib/shared-*.js'],
  '@redspark/rsh-native-web-session-controller': ['lib/shared-*.js'],
  '@redspark/rsh-native-schedule-controller': ['lib/shared-*.js'],
  '@redspark/rsh-native-jobs-controller': ['lib/shared-*.js'],
  '@redspark/rsh-client-ui-jobs': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-settings-plugin-inventory': ['lib/**/*.css'],
  '@redspark/rsh-client-ui-settings-models': ['lib/**/*.css'],
  '@redspark/rsh-client-native-session': [
    'lib/list-types.js', 'lib/follow-types.js', 'lib/model-controls.js',
    'lib/human.js', 'lib/workspaces.js', 'lib/schedule-types.js', 'lib/jobs-types.js', 'lib/native-*.js',
    'lib/shared-*.js', 'lib/workspaces-*.js',
  ],
  '@redspark/rsh-host-directory-picker-native': ['lib/native-picker.js', 'lib/native-picker-*.js'],
  '@redspark/rsh-client-native-application': ['lib/controller.js', 'lib/controller-*.js', 'lib/native-*.js', 'lib/*.css'],
  '@redspark/rsh-native-acp': ['lib/shared-*.js'],
  // Workflow's native Definition, typed source leaves, and worker/Consumer
  // bundles are published alongside the existing Cordis package entry.
  '@redspark/rsh-workflow': ['lib/errors.js', 'lib/types.js', 'lib/shared-*.js'],
  '@redspark/rsh-workflow-worker-thread': ['lib/shared-*.js'],
  '@redspark/rsh-tool-workflow': ['lib/foreground.js', 'lib/shared-*.js'],
  '@redspark/rsh-tool-ralph': ['lib/shared-*.js'],
  '@redspark/rsh-native-web-assets': ['lib/native-client.js', 'lib/shared-*.js'],
  '@redspark/rsh-native-tools': [
    'lib/json-schema.js', 'lib/code-output.js', 'lib/ts-types.js', 'lib/py-types.js',
    'lib/ordered-dispatch.js', 'lib/types.js', 'lib/presentation.js', 'lib/shared-*.js',
  ],
  '@redspark/rsh-client-connection': [
    'lib/native-host.js', 'lib/http-bridge.js', 'lib/native-http-bridge.js',
    'lib/host-core-*.js', 'lib/rpc-*.js', 'lib/recovery-config-*.js',
  ],
  '@redspark/rsh-agent-instructions': ['lib/shared-*.js'],
  '@redspark/rsh-native-headless': ['lib/shared-*.js'],
  '@redspark/rsh-native-session-execution': ['lib/root-route.js', 'lib/read-history.js', 'lib/shared-*.js'],
  '@redspark/rsh-native-agent': ['lib/inbox.js', 'lib/consumed-work.js', 'lib/turn-boundary.js'],
  '@redspark/rsh-session-query-sqlite': ['lib/core.js', 'lib/shared-*.js'],
  '@redspark/rsh-session-projection-cache': ['lib/shared-*.js'],
  '@redspark/rsh-session-projection': ['lib/shared-*.js'],
  '@redspark/rsh-tool-session-query': ['lib/shared-*.js'],
  '@redspark/rsh-native-model-execution': ['lib/shared-*.js', 'lib/model-selection.js', 'lib/model-directory.js', 'lib/adapter-directory.js'],
  '@redspark/rsh-token-meter': ['lib/shared-*.js'],
  '@redspark/rsh-compaction-basic': ['lib/shared-*.js'],
  '@redspark/rsh-compaction-tool-result-pruner': ['lib/shared-*.js'],
  '@redspark/rsh-command-compact': ['lib/shared-*.js'],
  '@redspark/rsh-llm-retry': ['lib/shared-*.js'],
  '@redspark/rsh-tool-call-timeout-policy': ['lib/shared-*.js'],
  '@redspark/rsh-repeat-tool-reminder': ['lib/shared-*.js'],
  '@redspark/rsh-native-model-selection': ['lib/types.js', 'lib/shared-*.js'],
  '@redspark/rsh-shell': ['lib/shared-*.js'],
  '@redspark/rsh-shell-env': ['lib/definition.js', 'lib/shared-*.js'],
  '@redspark/rsh-bash-local': ['lib/shared-*.js'],
  '@redspark/rsh-bash-sandbox': ['lib/shared-*.js'],
  '@redspark/rsh-pwsh-local': ['lib/resolve.js', 'lib/shared-*.js'],
  '@redspark/rsh-pwsh-sandbox': ['lib/shared-*.js'],
  '@redspark/rsh-tool-bash': ['lib/shared-*.js'],
  '@redspark/rsh-tool-pwsh': ['lib/shared-*.js'],
  '@redspark/rsh-terminal': ['lib/protocol.js', 'lib/error.js', 'lib/shared-*.js'],
  '@redspark/rsh-terminal-bash': ['lib/shared-*.js'],
  '@redspark/rsh-tool-terminal': ['lib/shared-*.js'],
  '@redspark/rsh-native-code-runtime': ['lib/shared-*.js', 'lib/process-child.js'],
  '@redspark/rsh-native-time-context': ['lib/types-*.js'],
  '@redspark/rsh-native-tmux-context': ['lib/shared-*.js'],
  // Legacy Cordis entries and native values share their pure implementations.
  '@redspark/rsh-session': ['lib/event-validation.js'],
  '@redspark/rsh-llm': ['lib/shared-*.js'],
  '@redspark/rsh-session-persistence': ['lib/deletion.js', 'lib/shared-*.js'],
  '@redspark/rsh-session-query': ['lib/shared-*.js'],
  '@redspark/rsh-session-reference': ['lib/shared-*.js'],
  // The Web Host mounts the default-off settings owner independently of each
  // Agent-scoped delegation-tool instance.
  // The JSONL backend resolves its private verification Worker relative to
  // import.meta.url; it is shipped without a public package subpath.
  '@redspark/rsh-session-persistence-jsonl': ['lib/worker.cjs', 'lib/native-inspection.js', 'lib/shared-*.js'],
  // The argv-prefix runner entry ships beside the lib as its own bundle;
  // sandbox-local resolves it through the package's ./runner export. tsdown
  // also shares its generated FFI code through a hashed runtime chunk.
  '@redspark/rsh-sandbox-windows-acl': ['lib/runner.js', 'lib/types-*.js'],
  '@redspark/rsh-skill-badge': ['assets'],
  // Ordinary native containment ships a path-loaded runner and its shared
  // runner chunk beside the existing node-pty permission repair.
  '@redspark/rsh-subprocess-local': [
    'lib/child-connection.js',
    'lib/shared-*.js',
    'lib/runner.js',
    'lib/runner-*.js',
    'scripts/ensure-spawn-helper.mjs',
  ],
  // tsdown shares the repository/pack code between the lib entry and the bin
  // through a hashed chunk. The committed bin.js is the link target pnpm can
  // resolve at install time, before the build produces lib/bin.js.
  '@redspark/rsh-experimental-webworker-packer': ['bin.js', 'lib/repository-*.js'],
}
const packageFileOverrides: Readonly<Record<string, readonly string[]>> = {
  // tsdown emits the SDK client's public entries and shared chunks together.
  '@redspark/rsh-sdk-client': ['lib/*.js', 'lib/types/**/*.d.ts'],
  // This package must publish its exact RedSpark research license with its native entries.
  '@redspark/rsh-acp-child': [
    'LICENSE-REDSPARK-RESEARCH.txt', 'lib/index.js', 'lib/native.js', 'lib/shared-*.js', 'lib/types/**/*.d.ts',
  ],
  '@redspark/rsh-session-log-export': [
    'lib/index.js', 'lib/native.js', 'lib/client.js', 'lib/shared-*.js', 'lib/types/**/*.d.ts',
  ],
}

function sameStringList(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

export function expectedRshPackageFiles(manifest: PackageManifest): readonly string[] {
  const override = manifest.name ? packageFileOverrides[manifest.name] : undefined
  if (override !== undefined) return override
  const declaredPatch = manifest.dsh?.bundle?.patch
  const bundleFiles = declaredPatch === undefined ? [] : [declaredPatch.replace(/^\.\//, '')]
  const extras = [
    ...bundleFiles,
    ...(manifest.name ? packageFileExtras[manifest.name] ?? [] : []),
  ]
  return [
    'lib/index.js',
    // Packages with an invariant export publish its runtime as a separate
    // bundle; the package-invariant gate validates the source/export pairing.
    ...manifest.exports?.['./invariant'] ? ['lib/invariant.js'] : [],
    ...manifest.bin ? ['lib/bin.js'] : [],
    // Worker-thread packages ship a CJS worker entry; the browser worker
    // bundle is an ES module a page loads with `new Worker(type: 'module')`.
    // Keyed on the artifact path, like ./client below.
    ...exportDefault(manifest, './worker') === './lib/worker.cjs' ? ['lib/worker.cjs'] : [],
    ...exportDefault(manifest, './worker') === './lib/worker.js' ? ['lib/worker.js'] : [],
    // UI plugin packages ship their browser bundle beside the node lib
    // (single-artifact ruling: dist/ retired, ./client resolves lib/client.js).
    // Keyed on the artifact path, not the subpath name: a package's ./client is
    // a browser-safe source channel, not a bundle.
    ...exportDefault(manifest, './client') === './lib/client.js' ? ['lib/client.js'] : [],
    // The native entry is its own bundle whatever face it serves, and a package
    // may publish it without a ./client half. Keyed on the artifact path for
    // the same reason as ./client: a ./native that re-exports the tsc-emitted
    // tree is already covered by the emitted-tree defaults below.
    ...exportDefault(manifest, './native') === './lib/native.js' ? ['lib/native.js'] : [],
    // runtime's shell-held loader subpath ships as its own bundle beside the client half.
    ...exportDefault(manifest, './loader') === './lib/loader.js' ? ['lib/loader.js'] : [],
    // A store subpath ships its own bundle (single-entry builds; no shared chunk).
    ...exportDefault(manifest, './store') === './lib/store/index.js' ? ['lib/store/index.js'] : [],
    // A surface bundle's startup row is its own bundle: the Loader imports it
    // as a row module, so it cannot ride inside the package entry.
    ...exportDefault(manifest, './startup') === './lib/startup.js' ? ['lib/startup.js'] : [],
    // A runtime adapter is a Loader-imported host bundle; published packages
    // must carry it independently of their ordinary index entry.
    ...exportDefault(manifest, './runtime') === './lib/runtime.js' ? ['lib/runtime.js'] : [],
    ...exportDefault(manifest, './runtime') === './lib/runtime-definition.js' ? ['lib/runtime-definition.js'] : [],
    ...extras,
    // Subpaths whose runtime default is the tsc-emitted tree (lib/types/*.js —
    // browser-safe source channels rehomed off src so plain Node can import
    // them without type stripping) publish the emitted JS alongside the
    // declarations.
    ...usesEmittedTreeDefaults(manifest) ? ['lib/types/**/*.js'] : [],
    'lib/types/**/*.d.ts',
    ...hasExportPair(manifest, './typert', './lib/typert.host.d.ts', './lib/typert.host.js')
      ? ['lib/typert.host.js', 'lib/typert.host.d.ts']
      : [],
    ...hasExportPair(manifest, './client/typert', './lib/typert.client.d.ts', './lib/typert.client.js')
      ? ['lib/typert.client.js', 'lib/typert.client.d.ts']
      : [],
    ...hasTypertRemoteNavigation(manifest)
      ? ['lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts']
      : [],
  ]
}

/** Whether one conditional export exactly names the generated runtime and declaration pair. */
function hasExportPair(
  manifest: PackageManifest,
  subpath: string,
  types: string,
  runtime: string,
): boolean {
  const entry = manifest.exports?.[subpath]
  return typeof entry === 'object'
    && entry !== null
    && entry.types === types
    && entry.default === runtime
}

/** Runtime target of an export entry: conditional `default`, or the bare-string shorthand. */
function exportDefault(manifest: PackageManifest, subpath: string): string | undefined {
  const entry = manifest.exports?.[subpath]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null) return entry.default
  return undefined
}

/** Whether any export's runtime default points into the tsc-emitted lib/types tree. */
function usesEmittedTreeDefaults(manifest: PackageManifest): boolean {
  return Object.keys(manifest.exports ?? {}).some(subpath =>
    exportDefault(manifest, subpath)?.startsWith('./lib/types/') === true)
}

/** Experimental manifest requirements, including explicit public exceptions. */
export function checkExperimentalManifest({ dir, manifest }: WorkspaceManifest): string[] {
  if (!experimentalPackageDirectory.test(dir)) return []
  const label = manifest.name ?? dir
  const errors: string[] = []
  if (manifest.name?.startsWith(experimentalPackageNamePrefix) !== true) {
    errors.push(`${label}: experimental package name must start with ${JSON.stringify(experimentalPackageNamePrefix)}`)
  }
  if (isPublicExperimentalPackageDirectory(dir)) {
    if (manifest.private === true) errors.push(`${label}: public experimental package must not set "private": true`)
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: public experimental package must set publishConfig.access to "public"`)
    }
  } else {
    if (manifest.private !== true) errors.push(`${label}: experimental package must set "private": true`)
    if (manifest.publishConfig !== undefined) errors.push(`${label}: experimental package must omit publishConfig`)
  }
  return errors
}

function isReleaseMemberDirectory(dir: string): boolean {
  if (dir === privateDesktopAssemblyDirectory) return false
  return standardReleaseMemberDirectory.test(dir) || isPublicExperimentalPackageDirectory(dir)
}

/** Whether a package belongs to the product library policy rather than an application root. */
function isRshLibraryDirectory(dir: string): boolean {
  return !applicationDistributionDirectories.has(dir) && [
    'rsh/Core/',
    'rsh/Engine/',
    'rsh/Modules/Official/',
    'rsh/Modules/Community/',
    'rsh/Compatibility/DSH/',
    'rsh/Programs/TUI/',
    'rsh/Programs/ACP/packages/',
    'rsh/Programs/SDK/packages/',
    'rsh/Programs/Web/api/',
    'rsh/Programs/Web/client/',
    'rsh/Programs/Web/host/',
    'rsh/Tests/test-support/',
  ].some(prefix => dir.startsWith(prefix))
    && !dir.startsWith('rsh/Core/vendor/')
    && !dir.startsWith('rsh/Core/native/')
}

/** Require Cordis according to whether a DSH library is native, mixed, or compatibility-only. */
export function checkCordisPeerPolicy({ dir, manifest }: WorkspaceManifest): string[] {
  if (!isRshLibraryDirectory(dir) || manifest.name?.startsWith('@redspark/rsh-') !== true) return []
  const label = manifest.name
  const peer = manifest.peerDependencies?.['@redspark/cordis']
  const dev = manifest.devDependencies?.['@redspark/cordis']
  const optionalPeer = manifest.peerDependenciesMeta?.['@redspark/cordis']?.optional
  const direct = manifest.dependencies?.['@redspark/cordis']
    ?? manifest.optionalDependencies?.['@redspark/cordis']
  const native = nativePackageDirectories.has(dir)
  const mixed = mixedNativeEntryDirectories.has(dir)
    || mixedNativeLibraryDirectories.has(dir)
    || nativeSafeSourceSubpaths.has(dir)
  const compatibilityOnlyPeer = nativeCompatibilityOnlyPeers.get(dir)?.includes('@redspark/cordis') === true
  const errors: string[] = []

  if (native) {
    if (peer !== undefined || dev !== undefined || optionalPeer !== undefined || direct !== undefined) {
      errors.push(`${label}: native runtime must not declare Cordis dependencies`)
    }
    return errors
  }

  if (mixed) {
    if (peer === undefined) errors.push(`${label}: mixed native package must declare Cordis as a peerDependency`)
    if (dev === undefined) errors.push(`${label}: mixed native package must also declare Cordis as a devDependency`)
    if (optionalPeer !== true) errors.push(`${label}: mixed native package must mark the Cordis peer as optional`)
  } else {
    if (peer === undefined) errors.push(`${label}: @redspark/cordis must be a peerDependency`)
    if (dev === undefined) errors.push(`${label}: @redspark/cordis must also be a devDependency`)
    if (optionalPeer === true && !compatibilityOnlyPeer) {
      errors.push(`${label}: compatibility package must keep the Cordis peer required`)
    }
  }

  if (direct !== undefined) errors.push(`${label}: @redspark/cordis must not be a direct dependency`)
  if (peer !== undefined && dev !== undefined && peer !== dev) {
    errors.push(`${label}: @redspark/cordis peer (${peer}) and dev (${dev}) ranges must match`)
  }
  return errors
}

/**
 * Require a dsh-family manifest to carry the workspace version.
 *
 * The dsh release sequence publishes product members and every
 * private dsh package on one shared version, written by `release:dsh` and
 * shared with the workspace root. This name test is that boundary: it covers
 * the family wherever the manifest lives, so application members cannot drift with
 * only the release lane noticing.
 * @param manifest - the workspace package manifest.
 * @param expected - the version every dsh-family manifest must carry (the root's).
 * @returns one violation naming the manifest and the expected version, or
 * undefined when the manifest is compliant or not in the family.
 */
export function checkRshFamilyVersion(manifest: PackageManifest, expected: string | undefined): string | undefined {
  const name = manifest.name
  if (name !== '@redspark/rsh' && name?.startsWith('@redspark/rsh-') !== true) return undefined
  if (manifest.version !== expected) {
    return `${name}: package.json version must match root version ${expected ?? '(missing)'}`
  }
  return undefined
}

/**
 * Check one workspace manifest against publication and dsh-package policy.
 * @param workspace - package directory and parsed manifest.
 * @returns path-qualified policy violations.
 */
export function checkWorkspaceManifest({ dir, manifest }: WorkspaceManifest): string[] {
  const errors = checkExperimentalManifest({ dir, manifest })
  const label = manifest.name ?? dir
  const familyVersionError = checkRshFamilyVersion(manifest, repositoryVersion)
  if (familyVersionError !== undefined) errors.push(familyVersionError)
  const isNativePackageDir = dir.startsWith('rsh/Core/native/system/packages/')
  const isPublicNativePackage = isNativePackageDir
    && manifest.name !== undefined
    && publicNativePackages.has(manifest.name)

  if (isPublicNativePackage) {
    if (manifest.private === true) {
      errors.push(`${label}: published Landlock package must not set "private": true`)
    }
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: published Landlock package must set publishConfig.access to "public"`)
    }
    const expectedDirectory = dir
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== repositoryUrl
      || manifest.repository.directory !== expectedDirectory) {
      errors.push(`${label}: published Landlock package repository must use ${repositoryUrl} with directory ${expectedDirectory} for trusted publishing`)
    }
  } else if (dir === privateDesktopAssemblyDirectory) {
    if (manifest.private !== true) {
      errors.push(`${label}: private Desktop assembly must set "private": true`)
    }
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== publishedRepositoryUrl
      || manifest.repository.directory !== dir) {
      errors.push(`${label}: private Desktop assembly repository must use ${publishedRepositoryUrl} with directory ${dir}`)
    }
  } else if (isReleaseMemberDirectory(dir)) {
    // Release members state that they are publishable: npm refuses a private
    // package, and the repository field is how a consumer finds the source of
    // the package it installed.
    //
    // Access is per release sequence, not per scope: the vendored framework and
    // the Landlock packages publish publicly because outside consumers install
    // them, and the dsh family published publicly with its own sequence on
    // 2026-08-13. No publish path passes `--access`; each packed manifest declares
    // it, and this gate requires every release member to be public.
    if (manifest.private === true) {
      errors.push(`${label}: release member must not set "private": true`)
    }
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: release member must set publishConfig.access to "public"`)
    }
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== publishedRepositoryUrl
      || manifest.repository.directory !== dir) {
      errors.push(`${label}: release member repository must use ${publishedRepositoryUrl} with directory ${dir}`)
    }
  } else if (!experimentalPackageDirectory.test(dir) && manifest.private !== true) {
    errors.push(`${label}: package.json must set "private": true`)
  }

  if (manifest.name && vendoredPackages.has(manifest.name)) {
    return errors
  }

  if (manifest.name?.startsWith('@redspark/')) {
    const allowedSources = publicationSourceAllowlist[manifest.name] ?? []
    for (const file of manifest.files ?? []) {
      if (isForbiddenPublicationFile(file) && !allowedSources.includes(file)) {
        errors.push(`${label}: package.json files must not publish ${JSON.stringify(file)}`)
      }
    }
  }

  if (applicationPackageDirectories.has(dir) && dir !== desktopApplicationDirectory && manifest.name?.startsWith('@redspark/')) {
    const expectedFiles = appPackageFiles[manifest.name]
    if (expectedFiles === undefined) {
      errors.push(`${label}: app package has no publication files policy`)
    } else if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  if (isNativePackageDir) {
    if (!isPublicNativePackage) {
      errors.push(`${label}: unexpected package in the public Landlock package family`)
    }
    if (manifest.version !== nativeVersion) {
      errors.push(`${label}: package.json version must match native workspace version ${nativeVersion ?? '(missing)'}`)
    }
  }

  if (isRshLibraryDirectory(dir) && manifest.name?.startsWith('@redspark/rsh-')) {
    errors.push(...checkCordisPeerPolicy({ dir, manifest }))
    if (manifest.type !== 'module') {
      errors.push(`${label}: package.json must set "type": "module"`)
    }
    if (manifest.main !== 'lib/index.js') {
      errors.push(`${label}: package.json must set "main": "lib/index.js"`)
    }
    if (manifest.types !== 'lib/types/index.d.ts') {
      errors.push(`${label}: package.json must set "types": "lib/types/index.d.ts"`)
    }
    const rootExport = manifest.exports?.['.']
    const rootEntry = typeof rootExport === 'object' && rootExport !== null ? rootExport : undefined
    if (rootEntry?.types !== './lib/types/index.d.ts') {
      errors.push(`${label}: package.json exports["."].types must be "./lib/types/index.d.ts"`)
    }
    if (rootEntry?.default !== './lib/index.js') {
      errors.push(`${label}: package.json exports["."].default must be "./lib/index.js"`)
    }
    const invariantRaw = manifest.exports?.['./invariant']
    const invariantExport = typeof invariantRaw === 'object' && invariantRaw !== null ? invariantRaw : undefined
    if (invariantExport?.types !== undefined && invariantExport.types !== './lib/types/invariant.d.ts') {
      errors.push(`${label}: package.json exports["./invariant"].types must be "./lib/types/invariant.d.ts"`)
    }
    if (invariantExport?.default !== undefined && invariantExport.default !== './lib/invariant.js') {
      errors.push(`${label}: package.json exports["./invariant"].default must be "./lib/invariant.js"`)
    }
    if (invariantExport && (invariantExport.types === undefined || invariantExport.default === undefined)) {
      errors.push(`${label}: package.json exports["./invariant"] must declare both types and default targets`)
    }
    const expectedFiles = expectedRshPackageFiles(manifest)
    if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  return errors.map(error => `${relative(root, join(root, dir, 'package.json'))}: ${error}`)
}

/**
 * Enforce the grouped physical package layout for Core, Engine, Modules, and
 * Compatibility. Programs and test fixtures have their own layouts.
 */
function checkHierarchyShape(): string[] {
  const errors: string[] = []
  const groupedRoots = [
    'rsh/Core',
    'rsh/Engine',
    'rsh/Modules/Official',
    'rsh/Modules/Community',
    'rsh/Compatibility/DSH',
  ]
  for (const groupedRoot of groupedRoots) {
    for (const group of readdirSync(join(root, groupedRoot), { withFileTypes: true })) {
      if (!group.isDirectory() || (groupedRoot === 'rsh/Core' && ['native', 'vendor'].includes(group.name))) continue
      const groupRel = `${groupedRoot}/${group.name}`
      if (existsSync(join(root, groupRel, 'package.json'))) {
        errors.push(`${groupRel}: a group dir must not contain a package.json — packages live at ${groupRel}/<pkg>`)
        continue
      }
      for (const pkg of readdirSync(join(root, groupRel), { withFileTypes: true })) {
        if (!pkg.isDirectory() || localArtifactDirs.has(pkg.name)) continue
        const pkgRel = `${groupRel}/${pkg.name}`
        if (!existsSync(join(root, pkgRel, 'package.json'))) {
          errors.push(`${pkgRel}: expected a package here (no package.json found) — grouped packages must be exactly one level below ${groupRel}`)
        }
      }
    }
  }
  return errors
}

function checkRepositoryVersion(): string[] {
  // The root carries the dsh release family's version, so a prerelease such as
  // 0.0.1-rc.1 is a valid state between `release:dsh` and its publication.
  if (repositoryVersion && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(repositoryVersion)) return []
  return ['package.json: version must be X.Y.Z with an optional prerelease segment']
}

/** Dependency sections whose ranges reach a published tarball or a local install. */
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
/** Dependency sections present in an installed runtime. */
const runtimeDependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const
const runtimeRoles = ['definition', 'provider', 'consumer', 'policy', 'projection', 'adapter'] as const
type RuntimeRole = typeof runtimeRoles[number]
type RuntimeLayer = 'core' | 'engine' | 'module' | 'compatibility' | 'program' | 'support'

/** One reviewed dependency that temporarily crosses the runtime ownership rules. */
interface RuntimeLayerException {
  readonly consumer: string
  readonly section: typeof runtimeDependencySections[number]
  readonly dependency: string
  readonly reason: string
}

/**
 * Current transition edges whose consumers need a published capability outside
 * their ordinary runtime layer. Every exception names one manifest edge and is
 * rejected when it becomes stale.
 */
const runtimeLayerExceptions: readonly RuntimeLayerException[] = []

/** Classify a workspace package by its physical owner. */
export function runtimeLayerOf(dir: string): RuntimeLayer {
  if (dir.startsWith('rsh/Core/')) return 'core'
  if (dir.startsWith('rsh/Engine/')) return 'engine'
  if (dir.startsWith('rsh/Modules/Official/') || dir.startsWith('rsh/Modules/Community/')) return 'module'
  if (dir.startsWith('rsh/Compatibility/')) return 'compatibility'
  if (dir.startsWith('rsh/Programs/')) return 'program'
  return 'support'
}

function runtimeRoleOf(manifest: PackageManifest): RuntimeRole | undefined {
  const runtime = manifest.dsh?.runtime
  if (runtime === undefined) return undefined
  if (runtime.apiVersion !== 1) return undefined
  return runtimeRoles.find(role => role === runtime.role)
}

function runtimeExceptionKey(exception: RuntimeLayerException): string {
  return `${exception.consumer}\0${exception.section}\0${exception.dependency}`
}

/**
 * Reject runtime dependencies that bypass Core/Engine/module ownership. Package
 * manifests state the initial policy because source import enforcement must
 * separately resolve Host and Client compiler faces.
 * @param manifests - all workspace package manifests.
 * @param options - enables stale-exception enforcement for complete workspace scans.
 * @returns deterministic diagnostics for invalid declarations and stale exemptions.
 */
export function collectRuntimeLayerViolations(
  manifests: readonly WorkspaceManifest[],
  options: { validateExceptions?: boolean } = {},
): string[] {
  const packages = new Map(manifests
    .filter(entry => entry.manifest.name !== undefined)
    .map(entry => [entry.manifest.name as string, entry]))
  const errors: string[] = []
  const exceptions = new Map<string, RuntimeLayerException>()
  for (const exception of runtimeLayerExceptions) {
    const key = runtimeExceptionKey(exception)
    if (exceptions.has(key)) {
      errors.push(`runtime-layer policy duplicates exception ${exception.consumer}: ${exception.section}.${exception.dependency}`)
    }
    exceptions.set(key, exception)
  }

  const consumedExceptions = new Set<string>()
  for (const entry of manifests) {
    const consumer = entry.manifest.name
    if (consumer === undefined) continue
    const consumerLayer = runtimeLayerOf(entry.dir)
    const consumerRole = runtimeRoleOf(entry.manifest)
    const runtime = entry.manifest.dsh?.runtime
    if (runtime !== undefined) {
      if (runtime.apiVersion !== 1 || runtimeRoleOf(entry.manifest) === undefined
        || typeof runtime.capability !== 'string' || runtime.capability.length === 0 || runtime.capability.trim() !== runtime.capability) {
        errors.push(`${consumer}: dsh.runtime must declare apiVersion 1, a supported role, and a non-blank capability`)
      }
    }

    for (const section of runtimeDependencySections) {
      for (const dependency of Object.keys(entry.manifest[section] ?? {}).sort()) {
        const target = packages.get(dependency)
        if (target === undefined) continue
        const key = runtimeExceptionKey({ consumer, section, dependency, reason: '' })
        const exception = exceptions.get(key)
        if (exception !== undefined) {
          consumedExceptions.add(key)
          continue
        }

        const targetLayer = runtimeLayerOf(target.dir)
        const targetRole = runtimeRoleOf(target.manifest)
        let violation: string | undefined
        if (consumerLayer === 'core' && targetLayer !== 'core') {
          violation = 'Core packages may not consume Engine, module, compatibility, or Program packages'
        } else if (consumerLayer === 'engine' && targetLayer === 'program') {
          violation = 'Engine packages may not consume Program packages'
        } else if (consumerLayer === 'engine' && targetLayer === 'compatibility') {
          violation = 'Engine packages may not consume Compatibility packages'
        } else if (consumerLayer === 'engine' && targetLayer === 'module' && targetRole === 'provider') {
          violation = 'Engine packages may not consume module Providers'
        } else if (consumerLayer === 'module' && targetLayer === 'program'
          && !entry.dir.startsWith('rsh/Modules/Community/experimental/')) {
          violation = 'Module packages may not consume Program packages'
        } else if (consumerLayer === 'module' && consumerRole === 'consumer' && targetLayer === 'module' && targetRole === 'provider') {
          violation = 'module Consumers may not consume module Providers'
        }
        if (violation !== undefined) {
          errors.push(`${consumer}: ${section}.${dependency} violates runtime-layer policy: ${violation}`)
        }
      }
    }
  }

  if (options.validateExceptions) {
    for (const [key, exception] of exceptions) {
      if (!consumedExceptions.has(key)) {
        errors.push(`runtime-layer policy has stale exception ${exception.consumer}: ${exception.section}.${exception.dependency}`)
      }
    }
  }
  return errors.sort()
}

/**
 * Prevent an official runtime from requiring a package its release omits.
 * @param manifests - release, private experimental, and deployment-root manifests.
 * @returns One error for each forbidden runtime dependency.
 */
export function checkExperimentalDependencyIsolation(manifests: readonly WorkspaceManifest[]): string[] {
  const experimentalNames = new Set(manifests
    .filter(entry => experimentalPackageDirectory.test(entry.dir))
    .map(entry => entry.manifest.name)
    .filter(name => name !== undefined))
  const errors: string[] = []
  for (const { dir, manifest } of manifests) {
    if (!standardReleaseMemberDirectory.test(dir) && dir !== 'rsh/Programs/SDK/python/sdk-runtime') continue
    for (const section of runtimeDependencySections) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (!experimentalNames.has(name)) continue
        errors.push(`${manifest.name ?? dir}: ${section}.${name} must not reference an experimental package`)
      }
    }
  }
  return errors
}

/**
 * Require the `workspace:` protocol for every reference to a workspace member.
 *
 * A hand-written range says nothing about the version the workspace actually
 * carries, and `pnpm pack` leaves it alone: `^0.0.1` published from version
 * `0.0.2` names a version that does not exist. The protocol makes pack
 * substitute the member's real version, so no release step rewrites ranges.
 * @param manifests - every workspace manifest.
 * @returns One error per reference that names a workspace member without the protocol.
 */
function checkWorkspaceProtocol(manifests: readonly WorkspaceManifest[]): string[] {
  const members = new Set(manifests.map(entry => entry.manifest.name).filter(name => name !== undefined))
  const errors: string[] = []
  for (const { dir, manifest } of manifests) {
    for (const section of dependencySections) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!members.has(name) || range.startsWith('workspace:')) continue
        errors.push(`${manifest.name ?? dir}: ${section}.${name} must use the workspace: protocol, got ${range}`)
      }
    }
  }
  return errors
}

/** Run the repository constraint gate. */
export function main(): void {
  const manifests = workspaceManifests()
  const dependencyManifests = [
    ...manifests,
    { dir: 'rsh/Programs/SDK/python/sdk-runtime', manifest: readJson(join(root, 'rsh/Programs/SDK/python/sdk-runtime/package.json')) },
  ]
  const errors = [
    ...checkRepositoryVersion(),
    ...manifests.flatMap(checkWorkspaceManifest),
    ...checkWorkspaceProtocol(manifests),
    ...checkExperimentalDependencyIsolation(dependencyManifests),
    ...collectRuntimeLayerViolations(manifests, { validateExceptions: true }),
    ...checkHierarchyShape(),
    ...collectProjectReferenceFaceViolations(root),
  ]
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
