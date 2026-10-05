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
import { mixedNativeEntryDirectories, mixedNativeLibraryDirectories, nativePackageDirectories, nativeSafeSourceSubpaths } from './native-package-policy.ts'

const root = resolve(import.meta.dirname, '..', '..')
/** pnpm workspace manifests after the physical RSH migration. */
const WORKSPACE_MANIFEST_GLOB = 'rsh/**/package.json'
const NON_WORKSPACE_MANIFEST_PARTS = ['/tests/fixtures/', '/Programs/SDK/python/', '/Tests/benchmarks/']
const vendoredPackages = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-logger-console',
])
const publicNativePackages = new Set([
  '@deepseek-ai/node-addon-system',
  '@deepseek-ai/node-addon-system-darwin-arm64',
  '@deepseek-ai/node-addon-system-darwin-x64',
  '@deepseek-ai/node-addon-system-linux-arm64',
  '@deepseek-ai/node-addon-system-linux-x64',
])
/** Deliberate source payloads whose exact bytes are part of the package's audit surface. */
const publicationSourceAllowlist: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/node-addon-system': ['src/main.c', 'src/flock.c'],
}
const repositoryUrl = 'git+https://github.com/deepseek-harness/deepseek-harness.git'
/**
 * Source home the published packages point consumers at. It differs from
 * {@link repositoryUrl}, which the Landlock packages keep because npm resolves
 * their trusted publishing against the repository that runs the workflow.
 */
const publishedRepositoryUrl = 'git+https://github.com/deepseek-ai/deepseek-harness.git'
/** Packages that participate in the experimental policy. */
const experimentalPackageDirectory = /^rsh\/Modules\/Community\/experimental\/[^/]+$/
/** npm namespace reserved for experimental packages. */
const experimentalPackageNamePrefix = '@deepseek-ai/dsh-experimental-'
/** Ordinary directories whose packages this repository publishes: one release member each. */
const standardReleaseMemberDirectory = new RegExp('^(?:' + [
  'rsh/Core/vendor/[^/]+',
  'rsh/Core/(?!native/)[^/]+/[^/]+',
  'rsh/Engine/[^/]+/[^/]+',
  'rsh/Modules/Official/[^/]+/[^/]+',
  'rsh/Modules/Community/(?!experimental/)[^/]+/[^/]+',
  'rsh/Compatibility/DSH/[^/]+/[^/]+',
  'rsh/Programs/(?:ACP/packages|SDK/packages|Web/(?:api|client|host))/[^/]+',
  'rsh/Programs/(?:CLI|Web/application)',
  'rsh/Tests/test-support/[^/]+',
].join('|') + ')$')
/** Installable application assembled by electron-builder rather than published to npm. */
const desktopApplicationDirectory = 'rsh/Programs/Desktop'
const applicationPackageDirectories = new Set([
  'rsh/Programs/CLI',
  'rsh/Programs/Web/application',
  'rsh/Programs/DesktopHost',
])
const localArtifactDirs = new Set(['node_modules'])
const appPackageFiles: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/dsh': ['lib/*.js'],
  '@deepseek-ai/dsh-desktop-host': [
    'lib/index.js',
    'config/desktop.cordis.patch.yml',
  ],
  // Sourcemaps stay out by payload policy; the worker-preview surface
  // (dist/preview.html and dist/preview/) backs private experimental
  // packages and is not published.
  '@deepseek-ai/dsh-web-frontend': ['dist', '!dist/**/*.map', '!dist/preview.html', '!dist/preview'],
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
  '@deepseek-ai/dsh-llm-pi-ai': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-llm-deepseek': ['lib/native.js', 'lib/shared-*.js'],
  // Statically linked client libraries keep their stylesheets next to the emitted
  // JavaScript, which imports them by relative path: the compile shell runs
  // them through its own CSS pipeline, so the sheets are published artifacts.
  // The glob covers whichever sheets a package emits; sourcemaps stay
  // unpublished, as everywhere else in the repository.
  '@deepseek-ai/dsh-client-ui-primitives': ['lib/**/*.css'],
  '@deepseek-ai/dsh-client-ui-dockkit': ['lib/**/*.css'],
  '@deepseek-ai/dsh-client-web': ['lib/**/*.css', 'lib/native-boot.js'],
  '@deepseek-ai/dsh-client-ui-theme': ['lib/styles'],
  '@deepseek-ai/dsh-client-modules': ['lib/native.js'],
  // Direct native credential entries share backend bundles where necessary.
  '@deepseek-ai/dsh-credentials': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-credentials-local': ['lib/native.js', 'lib/backend.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-settings': ['lib/native.js'],
  '@deepseek-ai/dsh-settings-file': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-subprocess': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-storage': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-storage-json': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-storage-domain': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-launch-environment': ['lib/native.js', 'lib/layers.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-mcp-client': ['lib/native.js', 'lib/types.js', 'lib/shared-*.js'],
  // The CPython side ships as source .py files, published as-is rather than built.
  '@deepseek-ai/dsh-experimental-code-runtime-python': ['py/**/*.py'],
  // The shipped preset compositions travel inside the roster package.
  '@deepseek-ai/dsh-agent-presets': ['presets', 'lib/native.js', 'lib/selection.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-workspace': ['lib/native.js', 'lib/shared-*.js'],
  // The terminal bundle's entry and runtime export share a generated chunk.
  '@deepseek-ai/dsh-rsh': ['lib/runtime.js', 'lib/runtime-*.js'],
  // Native filesystem entries share their storage and error implementations
  // across the legacy root and direct native package exports.
  '@deepseek-ai/dsh-fs': [
    'lib/native.js', 'lib/runtime.js', 'lib/operations.js', 'lib/types.js', 'lib/shared-*.js',
  ],
  '@deepseek-ai/dsh-fs-local': [
    'lib/native.js', 'lib/backend.js', 'lib/shared-*.js',
  ],
  '@deepseek-ai/dsh-fs-sandbox': ['lib/types-*.js'],
  '@deepseek-ai/dsh-sandbox': ['lib/native-types.js', 'lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-sandbox-local': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-tool-code-runtime': ['lib/native.js'],
  '@deepseek-ai/dsh-code-runtime-process-sandbox': ['lib/native.js'],
  '@deepseek-ai/dsh-fs-observation-policy': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-tool-fs': ['lib/native.js', 'lib/read-image-core.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-native-web-host': ['lib/native.js'],
  '@deepseek-ai/dsh-native-acp': ['lib/native.js'],
  '@deepseek-ai/dsh-native-sdk-server': ['lib/native.js'],
  '@deepseek-ai/dsh-native-web-assets': ['lib/native-client.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-native-tools': [
    'lib/json-schema.js', 'lib/code-output.js', 'lib/ts-types.js', 'lib/py-types.js',
    'lib/ordered-dispatch.js', 'lib/types.js', 'lib/presentation.js', 'lib/shared-*.js',
  ],
  '@deepseek-ai/dsh-client-ui-renderer': ['lib/native.js'],
  '@deepseek-ai/dsh-client-connection': [
    'lib/native.js', 'lib/native-host.js', 'lib/http-bridge.js', 'lib/native-http-bridge.js',
    'lib/host-core-*.js', 'lib/rpc-*.js', 'lib/recovery-config-*.js',
  ],
  '@deepseek-ai/dsh-native-headless': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-native-session-execution': ['lib/root-route.js', 'lib/read-history.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-native-agent': ['lib/inbox.js'],
  '@deepseek-ai/dsh-native-model-execution': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-pwsh-local': ['lib/resolve.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-native-code-runtime': ['lib/native.js', 'lib/shared-*.js', 'lib/process-child.js'],
  '@deepseek-ai/dsh-native-time-context': ['lib/native.js', 'lib/types-*.js'],
  // Legacy Cordis entries and native values share their pure implementations.
  '@deepseek-ai/dsh-session': ['lib/native.js'],
  '@deepseek-ai/dsh-llm': ['lib/native.js', 'lib/shared-*.js'],
  '@deepseek-ai/dsh-session-persistence': ['lib/native.js', 'lib/deletion.js', 'lib/shared-*.js'],
  // The Web Host mounts the default-off settings owner independently of each
  // Agent-scoped delegation-tool instance.
  '@deepseek-ai/dsh-tool-subagent': ['lib/model-selection-settings.js'],
  // The JSONL backend resolves its private verification Worker relative to
  // import.meta.url; it is shipped without a public package subpath.
  '@deepseek-ai/dsh-session-persistence-jsonl': ['lib/worker.cjs', 'lib/native.js', 'lib/shared-*.js'],
  // The argv-prefix runner entry ships beside the lib as its own bundle;
  // sandbox-local resolves it through the package's ./runner export. tsdown
  // also shares its generated FFI code through a hashed runtime chunk.
  '@deepseek-ai/dsh-sandbox-windows-acl': ['lib/runner.js', 'lib/types-*.js'],
  '@deepseek-ai/dsh-skill-badge': ['assets'],
  // Ordinary native containment ships a path-loaded runner and its shared
  // runner chunk beside the existing node-pty permission repair.
  '@deepseek-ai/dsh-subprocess-local': [
    'lib/native.js',
    'lib/shared-*.js',
    'lib/runner.js',
    'lib/runner-*.js',
    'scripts/ensure-spawn-helper.mjs',
  ],
  // tsdown shares the repository/pack code between the lib entry and the bin
  // through a hashed chunk. The committed bin.js is the link target pnpm can
  // resolve at install time, before the build produces lib/bin.js.
  '@deepseek-ai/dsh-experimental-webworker-packer': ['bin.js', 'lib/repository-*.js'],
}

function sameStringList(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

export function expectedDshPackageFiles(manifest: PackageManifest): readonly string[] {
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
  return standardReleaseMemberDirectory.test(dir) || isPublicExperimentalPackageDirectory(dir)
}

/** Whether a package belongs to the product library policy rather than an application root. */
function isDshLibraryDirectory(dir: string): boolean {
  return [
    'rsh/Core/',
    'rsh/Engine/',
    'rsh/Modules/Official/',
    'rsh/Modules/Community/',
    'rsh/Compatibility/DSH/',
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
  if (!isDshLibraryDirectory(dir) || manifest.name?.startsWith('@deepseek-ai/dsh-') !== true) return []
  const label = manifest.name
  const peer = manifest.peerDependencies?.['@deepseek-ai/cordis']
  const dev = manifest.devDependencies?.['@deepseek-ai/cordis']
  const optionalPeer = manifest.peerDependenciesMeta?.['@deepseek-ai/cordis']?.optional
  const direct = manifest.dependencies?.['@deepseek-ai/cordis']
    ?? manifest.optionalDependencies?.['@deepseek-ai/cordis']
  const native = nativePackageDirectories.has(dir)
  const mixed = mixedNativeEntryDirectories.has(dir)
    || mixedNativeLibraryDirectories.has(dir)
    || nativeSafeSourceSubpaths.has(dir)
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
    if (peer === undefined) errors.push(`${label}: @deepseek-ai/cordis must be a peerDependency`)
    if (dev === undefined) errors.push(`${label}: @deepseek-ai/cordis must also be a devDependency`)
    if (optionalPeer === true) errors.push(`${label}: compatibility package must keep the Cordis peer required`)
  }

  if (direct !== undefined) errors.push(`${label}: @deepseek-ai/cordis must not be a direct dependency`)
  if (peer !== undefined && dev !== undefined && peer !== dev) {
    errors.push(`${label}: @deepseek-ai/cordis peer (${peer}) and dev (${dev}) ranges must match`)
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
export function checkDshFamilyVersion(manifest: PackageManifest, expected: string | undefined): string | undefined {
  const name = manifest.name
  if (name !== '@deepseek-ai/dsh' && name?.startsWith('@deepseek-ai/dsh-') !== true) return undefined
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
  const familyVersionError = checkDshFamilyVersion(manifest, repositoryVersion)
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

  if (manifest.name?.startsWith('@deepseek-ai/')) {
    const allowedSources = publicationSourceAllowlist[manifest.name] ?? []
    for (const file of manifest.files ?? []) {
      if (isForbiddenPublicationFile(file) && !allowedSources.includes(file)) {
        errors.push(`${label}: package.json files must not publish ${JSON.stringify(file)}`)
      }
    }
  }

  if (applicationPackageDirectories.has(dir) && dir !== desktopApplicationDirectory && manifest.name?.startsWith('@deepseek-ai/')) {
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

  if (isDshLibraryDirectory(dir) && manifest.name?.startsWith('@deepseek-ai/dsh-')) {
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
    const expectedFiles = expectedDshPackageFiles(manifest)
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
const runtimeLayerExceptions: readonly RuntimeLayerException[] = [
  {
    consumer: '@deepseek-ai/dsh-agent-loop',
    section: 'peerDependencies',
    dependency: '@deepseek-ai/dsh-settings',
    reason: 'Agent-loop configuration still reads the published settings capability during the adapter-first transition.',
  },
  {
    consumer: '@deepseek-ai/dsh-subagent-dsh-sdk',
    section: 'peerDependencies',
    dependency: '@deepseek-ai/dsh-sdk-client',
    reason: 'The DSH SDK subagent bridge consumes the current Program-owned client API.',
  },
  {
    consumer: '@deepseek-ai/dsh-webhook-github',
    section: 'peerDependencies',
    dependency: '@deepseek-ai/dsh-host-webserver',
    reason: 'The GitHub webhook adapter integrates with the current Web host API.',
  },
  {
    consumer: '@deepseek-ai/dsh-tools',
    section: 'peerDependencies',
    dependency: '@deepseek-ai/dsh-user-approval',
    reason: 'The tool execution pipeline consumes the published approval capability until interaction contracts move to Engine.',
  },
  {
    consumer: '@deepseek-ai/dsh-tools',
    section: 'peerDependencies',
    dependency: '@deepseek-ai/dsh-code-runtime',
    reason: 'The tool registry carries the existing code-runtime execution integration while that capability remains an official module.',
  },
]

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
