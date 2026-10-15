/** In-place owner of the reserved desktop profile and its private pnpm state. */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { valid } from 'semver'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import {
  createNativePluginInventoryProvider, expandNativeProfilePresets, nativeProfileChildProviderRoutes, nativeProfileChildRuntimeProviders,
  nativeProfileChildSupportInstallations, profileDirectoryRuntime, profileDirectoryReloadMode, readNativeProfile,
  type NativeProfileChildRouteProvider, type NativeProfileConfig,
} from '@deepseek-ai/dsh/native-profile'
import { NativeScope, parseNativeEntryManifest,
  type NativeEntryManifest, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { parseNativeClientProfile, type NativeClientProfile } from '@deepseek-ai/dsh-native-web-assets/native-client'
import { load as loadYaml } from 'js-yaml'
import { spawn } from 'node:child_process'
import {
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import {
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import type { NativeHostPreflightInput, NativeHostPreflightReply } from './native-host-preflight-types.ts'
import { removeOwnedDirectory } from './owned-directory.ts'
import type { DesktopRelease } from './release.ts'
import { desktopRuntimeId, readDesktopRuntime, type DesktopRuntimeDescriptor } from './runtime-tree.ts'
import {
  desktopPluginLockHash, linkDesktopHostPackages, readDesktopProfileState,
  unlinkDesktopHostPackages, validateDesktopPluginGraph, type DesktopProfileState,
} from './profile-packages.ts'
import {
  NativeDesktopOperationFailure,
  type NativeDesktopBackendProjection,
  type NativeDesktopErrorCode,
  type NativeDesktopInstallationKey,
  type NativeDesktopInstallationId,
  type NativeDesktopInstallationView,
  type NativeDesktopInventory,
  type NativeDesktopInstallRequest,
  type NativeDesktopListOutcome,
  type NativeDesktopMutationOutcome,
  type NativeDesktopMutationRequest,
  type NativeDesktopPackageMutationRequest,
  type NativeDesktopPackageView,
  type NativeDesktopRevision,
  type NativeDesktopRetentionReason,
  type NativeDesktopScopeId,
  type NativeDesktopScopeView,
  type NativeDesktopTarget,
  type NativeDesktopToggleRequest,
  type NativeDesktopUpdateRequest,
} from './native-module-management.ts'
import type { DesktopBackendState } from './backend-controller.ts'

/** Desktop plugin record derived from the installed profile. */
export interface DesktopPluginRecord {
  readonly name: string
  readonly version: string
  readonly enabled: boolean
}

/** Installed desktop project manifest slice. */
interface DesktopProjectManifest {
  readonly name: string
  readonly private: true
  readonly version: string
  readonly dependencies: Record<string, string>
  readonly dsh: {
    readonly profile: {
      readonly bundles?: string[]
    }
  }
}

/** Exact executables the desktop shell bundles. */
export interface DesktopRuntimeExecutables {
  readonly node: string
  readonly pnpm: string
  readonly dsh: string
}

/** Hooks that stop the backend before profile writes and restart it after success. */
export interface DesktopProjectHooks {
  /** Stop the active backend and await process exit before modifying its files. */
  beforeChange(): Promise<void>
  /** Start the modified profile after package preparation succeeds. */
  afterChange(): Promise<void>
}

/** Supported dependency mutation. */
export type DesktopProjectMutation =
  | { readonly type: 'plugin-add'; readonly spec: string }
  | { readonly type: 'plugin-remove'; readonly name: string }
  | { readonly type: 'plugin-update'; readonly name: string; readonly version: string }
  | { readonly type: 'plugin-toggle'; readonly name: string; readonly enabled: boolean }
  | { readonly type: 'plugins-disable-all' }

const PROJECT_NAME = '@deepseek-ai/dsh-desktop-runtime'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\nstrictDepBuilds: true\n'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u
const MAX_PNPM_DIAGNOSTIC_BYTES = 64 * 1024
const DESKTOP_REGISTRY = 'https://registry.npmjs.org/'

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function workspaceFile(overrides: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = entries.length === 0
    ? ''
    : `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  const coreBuildSpec = overrides[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  esbuild: true\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertPackageName(name: string): void {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error(`desktop project: invalid npm package name ${JSON.stringify(name)}`)
}

function assertVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) throw new Error(`desktop project: invalid exact version ${JSON.stringify(version)}`)
}

/**
 * Validate one registry package spec and return its package name.
 * @param spec - npm registry name with an optional version or tag.
 * @returns Requested package name.
 */
export function packageNameFromSpec(spec: string): string {
  if (spec === '' || spec.startsWith('-') || /[\s\\]/u.test(spec) || spec.includes('://') || spec.startsWith('file:')) {
    throw new Error(`desktop project: unsupported npm package spec ${JSON.stringify(spec)}`)
  }
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    if (slash === -1) throw new Error(`desktop project: invalid scoped package spec ${JSON.stringify(spec)}`)
    const versionAt = spec.indexOf('@', slash)
    const name = versionAt === -1 ? spec : spec.slice(0, versionAt)
    assertPackageName(name)
    if (versionAt !== -1) assertVersion(spec.slice(versionAt + 1))
    return name
  }
  const versionAt = spec.indexOf('@')
  const name = versionAt === -1 ? spec : spec.slice(0, versionAt)
  assertPackageName(name)
  if (versionAt !== -1) assertVersion(spec.slice(versionAt + 1))
  return name
}

function projectManifest(projectDir: string): DesktopProjectManifest {
  const path = join(projectDir, 'package.json')
  const value = readJson(path)
  const dsh = isRecord(value) && isRecord(value.dsh) ? value.dsh : undefined
  const profile = isRecord(dsh?.profile) ? dsh.profile : undefined
  const native = profileDirectoryRuntime(projectDir) === 'native'
  if (!isRecord(value) || value.name !== PROJECT_NAME || value.private !== true
    || typeof value.version !== 'string' || (value.dependencies !== undefined && !isRecord(value.dependencies))
    || (!native && (!Array.isArray(profile?.bundles) || !profile.bundles.every(bundle => typeof bundle === 'string')))) {
    throw new Error(`desktop project: invalid desktop profile manifest ${path}`)
  }
  const manifest = { ...value, dependencies: value.dependencies ?? {} } as unknown as DesktopProjectManifest
  if (Object.entries(manifest.dependencies).some(([name, version]) => !PACKAGE_NAME_PATTERN.test(name)
    || typeof version !== 'string' || valid(version) !== version)) {
    throw new Error('desktop project: plugin dependencies must use exact registry versions')
  }
  return manifest
}

function profilePluginNames(projectDir: string): readonly string[] {
  const bundles = projectManifest(projectDir).dsh.profile.bundles
  if (bundles === undefined) throw new Error('desktop project: compatibility plugin management requires a Cordis profile')
  if (!DESKTOP_PROFILE_BUNDLES.every((bundle, index) => bundles[index] === bundle)) {
    throw new Error('desktop project: profile must begin with the built-in desktop bundle list')
  }
  const plugins = bundles.slice(DESKTOP_PROFILE_BUNDLES.length)
  if (new Set(bundles).size !== bundles.length) {
    throw new Error('desktop project: profile bundle list contains a duplicate package')
  }
  for (const plugin of plugins) assertPackageName(plugin)
  return plugins
}

function pluginRecords(projectDir: string): readonly DesktopPluginRecord[] {
  return Object.keys(projectManifest(projectDir).dependencies).sort().map(name => inspectPlugin(projectDir, name))
}

function writeProfilePlugins(projectDir: string, plugins: readonly DesktopPluginRecord[]): void {
  const manifest = projectManifest(projectDir)
  writeJson(join(projectDir, 'package.json'), {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh.profile,
        bundles: [...DESKTOP_PROFILE_BUNDLES, ...plugins.filter(plugin => plugin.enabled).map(plugin => plugin.name)],
      },
    },
  } satisfies DesktopProjectManifest)
}

function inspectPlugin(projectDir: string, requestedName: string): DesktopPluginRecord {
  const manifestPath = join(projectDir, 'node_modules', ...requestedName.split('/'), 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`desktop project: installed package ${JSON.stringify(requestedName)} has no manifest`)
  }
  const manifest = readJson(manifestPath)
  if (!isRecord(manifest) || manifest.name !== requestedName || typeof manifest.version !== 'string') {
    throw new Error(`desktop project: installed package ${JSON.stringify(requestedName)} has inconsistent name or version`)
  }
  const dsh = manifest.dsh
  const bundle = isRecord(dsh) ? dsh.bundle : undefined
  const patch = isRecord(bundle) ? bundle.patch : undefined
  if (typeof patch !== 'string' || patch === '') {
    throw new Error(`desktop project: ${requestedName}@${manifest.version} does not declare dsh.bundle.patch`)
  }
  const packageDir = dirname(manifestPath)
  const patchPath = resolve(packageDir, patch)
  if ((patchPath !== packageDir && !patchPath.startsWith(packageDir + sep)) || !existsSync(patchPath)) {
    throw new Error(`desktop project: ${requestedName}@${manifest.version} declares an invalid bundle patch`)
  }
  return { name: requestedName, version: manifest.version, enabled: profilePluginNames(projectDir).includes(requestedName) }
}

interface NativePackageMetadata {
  readonly name: string
  readonly version: string
  readonly root: string
  readonly manifestPath: string
  readonly entryPath: string
  readonly entry: NativeEntryManifest
}

interface NativeSelectedRow {
  readonly target: NativeDesktopTarget
  readonly id: string
  readonly plugin: string
  readonly scope?: string
  readonly config: unknown
  readonly hasConfig: boolean
  readonly disabled?: boolean
  readonly metadata: NativePackageMetadata
}

interface NativeProfileFiles {
  readonly host: NativeProfileConfig
  readonly client: NativeClientProfile
}

interface NativeResolvedComposition {
  readonly rows: readonly NativeSelectedRow[]
  /** CLI-owned packages added only to satisfy missing child-runtime services. */
  readonly supportRows: readonly NativeSelectedRow[]
  /** Selected required and optional Providers in their runtime ordering graph. */
  readonly dependencies: ReadonlyMap<string, readonly string[]>
  /** Required edges only; disabling an installation preserves this transitive closure. */
  readonly requiredDependencies: ReadonlyMap<string, readonly string[]>
  /** Actual profile-loader Providers serialized into Host preflight. */
  readonly profileProviders: readonly { readonly scope: string; readonly plugin: NativePlugin }[]
  readonly carrierKey: string
}

interface NativePlanningResult {
  readonly files: NativeProfileFiles
  readonly rows: readonly NativeSelectedRow[]
  readonly composition: NativeResolvedComposition
  readonly retained: Map<string, NativeDesktopRetentionReason[]>
}

interface NativeGraphNode {
  readonly key: string
  readonly scope: NativeScope
  readonly name: string
  readonly requires: readonly string[]
  readonly optional: readonly string[]
  readonly provides: readonly string[]
}

const desktopCarrierProvider = {
  apiVersion: 1,
  name: 'desktop-private-carrier',
  targets: ['host'],
  requires: ['credentials'],
  provides: ['hostConnection', 'application'],
  resolve: () => () => {},
} as unknown as NativePlugin

async function validateHostInFreshWorker(profile: NativeProfileConfig, rows: readonly NativeSelectedRow[],
  profileProviders: NativeResolvedComposition['profileProviders'], supportRows: readonly NativeSelectedRow[]): Promise<void> {
  const root = profile.scopes.find(scope => scope.parent === undefined)
  if (root === undefined) throw new Error('desktop native profile has no root scope')
  const workerData: NativeHostPreflightInput = {
    scopes: profile.scopes,
    installations: [...rows.filter(row => row.target === 'host'), ...supportRows].map((row) => {
      if (row.metadata.entry.provides.some(service => service === 'application' || service === 'hostConnection')) {
        throw new Error('desktop native profile selects a reserved Desktop provider')
      }
      if (row.scope === undefined) throw new Error(`desktop native installation has no scope: ${row.id}`)
      return { entryPath: row.metadata.entryPath, entry: row.metadata.entry, scope: row.scope, config: row.config }
    }),
    providers: profileProviders.map(({ scope, plugin }) => ({
      scope, apiVersion: plugin.apiVersion, name: plugin.name, targets: plugin.targets,
      requires: plugin.requires, optional: plugin.optional ?? [], provides: plugin.provides,
    })),
    carrierScope: root.id,
    carrier: {
      apiVersion: 1,
      name: desktopCarrierProvider.name,
      targets: desktopCarrierProvider.targets,
      requires: desktopCarrierProvider.requires,
      optional: desktopCarrierProvider.optional ?? [],
      provides: desktopCarrierProvider.provides,
    },
  }
  const source = import.meta.url.endsWith('.ts')
  const workerEntry = new URL(source ? './native-host-preflight-worker.ts' : './native-host-preflight-worker.js', import.meta.url)
  let entry: string | URL = workerEntry
  const options: WorkerOptions = { workerData, execArgv: [] }
  if (source) {
    const bootstrap = [
      `import { register as registerEsm } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}`,
      `import { register as registerCjs } from ${JSON.stringify(import.meta.resolve('tsx/cjs/api'))}`,
      'registerCjs()',
      'registerEsm()',
      `await import(${JSON.stringify(workerEntry.href)})`,
    ].join('\n')
    entry = new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`)
  }
  const worker = new Worker(entry, options)
  let received = false
  const result = new Promise<void>((resolve, reject) => {
    worker.once('message', (reply: NativeHostPreflightReply) => {
      received = true
      if (reply.valid) resolve()
      else reject(new Error(reply.message ?? 'Native Host preflight failed'))
    })
    worker.once('error', (reason) => {
      if (received) return
      received = true
      reject(reason)
    })
    worker.once('exit', (code) => {
      if (received) return
      received = true
      reject(new Error(`Native Host preflight worker exited without a result (${code})`))
    })
  })
  try { await result }
  finally { await worker.terminate() }
}

interface NativeCandidate {
  readonly files: NativeProfileFiles
  readonly rows: readonly NativeSelectedRow[]
  readonly validateBeforeStop: boolean
  readonly preflightFiles?: NativeProfileFiles
  readonly preflightRows?: readonly NativeSelectedRow[]
  readonly changed: boolean
  readonly blockedBy?: readonly NativeDesktopInstallationKey[]
  readonly packageOperation?: {
    readonly args: readonly string[]
    readonly filesAfterInstall?: NativeProfileFiles
    readonly writeFiles: boolean
  }
}

function within(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

function rowKey(target: NativeDesktopTarget, id: string): string { return `${target}\u0000${id}` }

function injectedProviderKey(name: string, scopeId: string): string { return `@desktop\u0000${name}\u0000${scopeId}` }

function selectedRows(files: NativeProfileFiles, profile: string, runtimeDir: string,
  runtime: DesktopRuntimeDescriptor): NativeSelectedRow[] {
  const rows: Omit<NativeSelectedRow, 'metadata'>[] = [
    ...files.host.installations.map(row => ({ target: 'host' as const, id: row.id, plugin: row.plugin,
      scope: row.scope, config: row.config, hasConfig: Object.hasOwn(row, 'config'),
      ...row.disabled === undefined ? {} : { disabled: row.disabled } })),
    ...files.client.installations.map(row => ({ target: 'client' as const, id: row.id, plugin: row.plugin,
      config: row.config, hasConfig: Object.hasOwn(row, 'config'),
      ...row.disabled === undefined ? {} : { disabled: row.disabled } })),
  ]
  const cache = new Map<string, NativePackageMetadata>()
  return rows.map((row) => {
    let metadata = cache.get(row.plugin)
    if (metadata === undefined) {
      metadata = nativePackageMetadata(profile, runtimeDir, runtime, row.plugin)
      cache.set(row.plugin, metadata)
    }
    if (!metadata.entry.targets.includes(row.target)) {
      throw new Error(`desktop native profile: ${row.plugin} does not support ${row.target}`)
    }
    return { ...row, metadata }
  })
}

function nativePackageMetadata(profile: string, runtimeDir: string, runtime: DesktopRuntimeDescriptor,
  name: string): NativePackageMetadata {
  assertPackageName(name)
  const shared = runtime.sharedPackages.find(item => item.name === name)
  const candidate = join(shared === undefined ? profile : runtimeDir, 'node_modules', ...name.split('/'))
  const manifestPath = join(candidate, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`desktop native package is unavailable: ${name}`)
  const root = realpathSync(candidate)
  const allowedRoot = realpathSync(shared === undefined ? profile : runtimeDir)
  if (!within(allowedRoot, root)) throw new Error(`desktop native package escaped its owner: ${name}`)
  const manifest = readJson(manifestPath)
  if (!isRecord(manifest) || manifest.name !== name || typeof manifest.version !== 'string'
    || valid(manifest.version) !== manifest.version || !isRecord(manifest.exports)) {
    throw new Error(`desktop native package has an invalid manifest: ${name}`)
  }
  const entry = parseNativeEntryManifest(
    isRecord(manifest.dsh) ? manifest.dsh.native : undefined,
    new Set(Object.keys(manifest.exports)),
  )
  const entryPath = realpathSync(createRequire(manifestPath).resolve(`${name}${entry.entry.slice(1)}`))
  if (!within(root, entryPath)) throw new Error(`desktop native package entry escaped its package: ${name}`)
  return { name, version: manifest.version, root, manifestPath, entryPath, entry }
}

function scopeTree(profile: NativeProfileConfig): ReadonlyMap<string, NativeScope> {
  const declarations = new Map(profile.scopes.map(row => [row.id, row]))
  const scopes = new Map<string, NativeScope>()
  const create = (id: string): NativeScope => {
    const existing = scopes.get(id)
    if (existing !== undefined) return existing
    const row = declarations.get(id)
    if (row === undefined) throw new Error(`desktop native profile has an unknown scope: ${id}`)
    const parent = row.parent === undefined ? undefined : create(row.parent)
    const scope = new NativeScope(parent)
    scopes.set(id, scope)
    return scope
  }
  for (const row of profile.scopes) create(row.id)
  return scopes
}

function validateStaticGraph(rows: readonly NativeSelectedRow[], host: NativeProfileConfig,
  resolvePackage: (name: string) => NativePackageMetadata,
  routeValidation: 'strict' | 'metadata' = 'strict'): NativeResolvedComposition {
  const routeProviders: NativeProfileChildRouteProvider[] = rows.flatMap((row) => {
    if (row.target !== 'host' || row.disabled === true) return []
    if (row.scope === undefined) throw new Error(`desktop native installation has no scope: ${row.id}`)
    return [{ id: row.id, plugin: row.plugin, scope: row.scope,
      ...row.hasConfig ? { config: row.config } : {}, provides: row.metadata.entry.provides }]
  })
  const routedHost = routeValidation === 'strict' ? nativeProfileChildProviderRoutes(host, routeProviders) : host
  const hostInstallations = new Map(routedHost.installations.map(row => [row.id, row]))
  const routedRows = rows.map((row) => {
    if (row.target !== 'host') return row
    const installation = hostInstallations.get(row.id)
    if (installation === undefined) throw new Error(`desktop native profile lost installation ${row.id}`)
    return { ...row, config: installation.config, hasConfig: Object.hasOwn(installation, 'config') }
  })
  const active = routedRows.filter(row => row.disabled !== true)
  const hostScopes = scopeTree(routedHost)
  const clientScope = new NativeScope()
  const scopeFor = (row: NativeSelectedRow): NativeScope => {
    if (row.target === 'client') return clientScope
    const scope = hostScopes.get(row.scope ?? '')
    if (scope === undefined) throw new Error(`desktop native installation has an unknown scope: ${row.id}`)
    return scope
  }
  const serviceProviders = active.filter(row => row.target === 'host' && row.scope !== undefined).map(row => ({
    scope: row.scope as string, provides: row.metadata.entry.provides,
  }))
  const disabledProvider = (ancestry: readonly string[], service: string): string | undefined => {
    for (const scope of ancestry) {
      const disabled = rows.find(row => row.target === 'host' && row.disabled === true && row.scope === scope
        && row.metadata.entry.provides.includes(service))
      if (disabled !== undefined) return disabled.plugin
    }
    return undefined
  }
  const supportRows = nativeProfileChildSupportInstallations(routedHost, serviceProviders, disabledProvider)
    .map((row): NativeSelectedRow => {
      const metadata = resolvePackage(row.plugin)
      if (!metadata.entry.provides.includes(row.service)) {
        throw new Error(`desktop child runtime package ${row.plugin} does not provide ${row.service}`)
      }
      return { target: 'host', id: row.id, plugin: row.plugin, scope: row.scope, config: undefined,
        hasConfig: false, metadata }
    })
  const graphRows = [...active, ...supportRows]
  const nodes: NativeGraphNode[] = graphRows.map(row => ({
    key: rowKey(row.target, row.id),
    scope: scopeFor(row),
    name: row.plugin,
    requires: row.metadata.entry.requires,
    optional: row.metadata.entry.optional,
    provides: row.metadata.entry.provides,
  }))
  const profileProviders: Array<{ readonly scope: string; readonly plugin: NativePlugin }> = []
  const launchEnvironment = launchEnvironmentProvider(createLaunchEnvironmentSnapshot([]))
  const roots = routedHost.scopes.filter(row => row.parent === undefined)
  for (const root of roots) {
    const scope = hostScopes.get(root.id)
    if (scope === undefined) throw new Error(`desktop native profile lost root scope ${root.id}`)
    nodes.push({
      key: injectedProviderKey(launchEnvironment.name, root.id),
      scope,
      name: launchEnvironment.name,
      requires: launchEnvironment.requires,
      optional: launchEnvironment.optional ?? [],
      provides: launchEnvironment.provides,
    })
    profileProviders.push({ scope: root.id, plugin: createNativePluginInventoryProvider(() => undefined) })
  }
  const childProviders = nativeProfileChildRuntimeProviders(routedHost,
    [...serviceProviders, ...supportRows.map(row => ({
      scope: row.scope as string, provides: row.metadata.entry.provides,
    }))], disabledProvider)
  profileProviders.push(...childProviders)
  for (const provider of profileProviders) {
    const scope = hostScopes.get(provider.scope)
    if (scope === undefined) throw new Error(`desktop native profile lost injected Provider scope ${provider.scope}`)
    nodes.push({
      key: injectedProviderKey(provider.plugin.name, provider.scope),
      scope,
      name: provider.plugin.name,
      requires: provider.plugin.requires,
      optional: provider.plugin.optional ?? [],
      provides: provider.plugin.provides,
    })
  }
  const root = roots[0]
  if (root === undefined) throw new Error('desktop native profile has no root scope')
  const carrierScope = hostScopes.get(root.id)
  if (carrierScope === undefined) throw new Error('desktop native profile lost its carrier scope')
  const carrierKey = injectedProviderKey(desktopCarrierProvider.name, root.id)
  nodes.push({
    key: carrierKey,
    scope: carrierScope,
    name: desktopCarrierProvider.name,
    requires: desktopCarrierProvider.requires,
    optional: desktopCarrierProvider.optional ?? [],
    provides: desktopCarrierProvider.provides,
  })
  const providerNodes = new Map<NativeScope, Map<string, NativeGraphNode[]>>()
  for (const node of nodes) {
    const scope = node.scope
    let scoped = providerNodes.get(scope)
    if (scoped === undefined) { scoped = new Map(); providerNodes.set(scope, scoped) }
    for (const service of node.provides) {
      const rowsForService = scoped.get(service) ?? []
      rowsForService.push(node)
      scoped.set(service, rowsForService)
    }
  }
  for (const services of providerNodes.values()) for (const [service, candidates] of services) {
    if (candidates.length > 1) throw new Error(`desktop native profile has duplicate ${service} providers in one scope`)
  }
  const findProvider = (node: NativeGraphNode, service: string): NativeGraphNode | undefined => {
    for (let scope: NativeScope | undefined = node.scope; scope !== undefined; scope = scope.parent) {
      const candidates = providerNodes.get(scope)?.get(service)
      if (candidates !== undefined) {
        if (candidates.length !== 1) throw new Error(`desktop native profile has ambiguous ${service} providers`)
        return candidates[0]
      }
    }
    return undefined
  }
  const dependencies = new Map<string, string[]>()
  const requiredDependencies = new Map<string, string[]>()
  for (const node of nodes) {
    const selected = new Set<string>()
    const required = new Set<string>()
    for (const service of [...node.requires, ...node.optional]) {
      const provider = findProvider(node, service)
      if (provider === undefined) {
        if (node.requires.includes(service)) throw new Error(`desktop native profile requires missing ${service} for ${node.name}`)
      } else {
        selected.add(provider.key)
        if (node.requires.includes(service)) required.add(provider.key)
      }
    }
    dependencies.set(node.key, [...selected])
    requiredDependencies.set(node.key, [...required])
  }
  const byKey = new Map(nodes.map(node => [node.key, node]))
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (key: string): void => {
    if (visiting.has(key)) {
      const node = byKey.get(key)
      throw new Error(`desktop native profile has a dependency cycle at ${node?.name ?? key}`)
    }
    if (visited.has(key)) return
    visiting.add(key)
    for (const dependency of dependencies.get(key) ?? []) visit(dependency)
    visiting.delete(key)
    visited.add(key)
  }
  nodes.forEach((node) => { visit(node.key) })
  return { rows: active, supportRows, dependencies, requiredDependencies, profileProviders, carrierKey }
}

function nativeRequiredClosure(
  files: NativeProfileFiles,
  composition: NativeResolvedComposition,
  persistedFiles: NativeProfileFiles = files,
): Map<string, NativeDesktopRetentionReason[]> {
  const retained = new Map<string, NativeDesktopRetentionReason[]>()
  const byKey = new Map(composition.rows.map(row => [rowKey(row.target, row.id), row]))
  const visited = new Set<string>()
  const include = (key: string, reason: NativeDesktopRetentionReason): void => {
    if (!composition.dependencies.has(key)) throw new Error('desktop native profile lost a required installation')
    const row = byKey.get(key)
    if (row !== undefined) {
      const reasons = retained.get(key) ?? []
      if (!reasons.includes(reason)) reasons.push(reason)
      retained.set(key, reasons)
    }
    if (visited.has(key)) return
    visited.add(key)
    for (const dependency of composition.requiredDependencies.get(key) ?? []) include(dependency, 'required-provider')
  }
  const hostRoots = files.host.scopes.filter(scope => scope.parent === undefined)
  const root = hostRoots[0]
  if (root === undefined) throw new Error('desktop native profile has no root scope')
  const controllers = composition.rows.filter(row => row.target === 'host' && row.metadata.entry.provides.includes('nativeWebSession'))
  const controller = controllers[0]
  if (controllers.length !== 1 || controller === undefined) throw new Error('desktop native profile requires exactly one native Session controller')
  include(rowKey(controller.target, controller.id), 'desktop-host-session')
  include(composition.carrierKey, 'desktop-private-carrier-provider')
  const hostScopes = scopeTree(files.host)
  const carrierScope = hostScopes.get(root.id)
  if (carrierScope === undefined) throw new Error('desktop native profile lost its root scope')
  let credentialProvider: NativeSelectedRow | undefined
  for (let scope: NativeScope | undefined = carrierScope; scope !== undefined && credentialProvider === undefined; scope = scope.parent) {
    credentialProvider = composition.rows.find(row => row.target === 'host' && hostScopes.get(row.scope ?? '') === scope
      && row.metadata.entry.provides.includes('credentials'))
  }
  if (credentialProvider === undefined) throw new Error('desktop native profile is missing its root credentials Provider')
  include(rowKey(credentialProvider.target, credentialProvider.id), 'desktop-private-carrier-provider')
  for (const service of ['clientApplication', 'clientRenderer']) {
    const providers = composition.rows.filter(row => row.target === 'client' && row.metadata.entry.provides.includes(service))
    const provider = providers[0]
    if (providers.length !== 1 || provider === undefined) throw new Error(`desktop native Client requires exactly one ${service} Provider`)
    include(rowKey(provider.target, provider.id), 'client-boot-requirement')
  }
  const persistedScopes = new Set(persistedFiles.host.scopes.map(scope => scope.id))
  const presetScopes = files.host.scopes.flatMap((scope) => {
    if (persistedScopes.has(scope.id) || scope.parent === undefined) return []
    const manager = composition.rows.find(row => row.target === 'host' && row.scope === scope.parent
      && row.plugin === '@deepseek-ai/dsh-agent-presets')
    const rows = composition.rows.filter(row => row.target === 'host' && row.scope === scope.id)
    if (manager === undefined || !rows.some(row => row.id === scope.id
      && row.plugin === '@deepseek-ai/dsh-agent-preset-standing')) return []
    return [{ managerKey: rowKey(manager.target, manager.id), rows }]
  })
  let addedPresetRows: boolean
  do {
    addedPresetRows = false
    for (const preset of presetScopes) {
      if (!retained.has(preset.managerKey) && !preset.rows.some(row => retained.has(rowKey(row.target, row.id)))) continue
      const previousSize = retained.size
      include(preset.managerKey, 'required-provider')
      for (const row of preset.rows) include(rowKey(row.target, row.id), 'required-provider')
      addedPresetRows ||= retained.size > previousSize
    }
  } while (addedPresetRows)
  return retained
}

async function planNativeComposition(files: NativeProfileFiles, profileDir: string, runtimeDir: string,
  runtime: DesktopRuntimeDescriptor, home: string,
  routeValidation: 'strict' | 'metadata' = 'strict'): Promise<NativePlanningResult> {
  const anchors = [createRequire(join(runtimeDir, 'package.json')), createRequire(join(profileDir, 'package.json'))]
  const host = await expandNativeProfilePresets(files.host, anchors, home)
  const effectiveFiles = { ...files, host }
  const rows = selectedRows(effectiveFiles, profileDir, runtimeDir, runtime)
  const composition = validateStaticGraph(rows, host,
    name => nativePackageMetadata(profileDir, runtimeDir, runtime, name), routeValidation)
  return { files: effectiveFiles, rows, composition,
    retained: nativeRequiredClosure(effectiveFiles, composition, files) }
}

async function validateNativeComposition(files: NativeProfileFiles, profileDir: string, runtimeDir: string,
  runtime: DesktopRuntimeDescriptor, home: string): Promise<void> {
  const plan = await planNativeComposition(files, profileDir, runtimeDir, runtime, home)
  await validateHostInFreshWorker(plan.files.host, plan.composition.rows,
    plan.composition.profileProviders, plan.composition.supportRows)
  // Client entry files can reference browser globals; esbuild validates them without executing them in the shell.
  // esbuild cannot spawn its binary from app.asar.
  const nativeClientModule = await import(pathToFileURL(
    createRequire(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'))
      .resolve('@deepseek-ai/dsh-native-web-assets/native-client'),
  ).href) as typeof import('@deepseek-ai/dsh-native-web-assets/native-client')
  await nativeClientModule.prepareNativeClientProfileBundle(profileDir, runtimeDir, files.client, true)
}

function parseNativeLock(text: string): unknown {
  try { return loadYaml(text) }
  catch { throw new NativeDesktopOperationFailure('recovery-required', true) }
}

function assertLockedVersion(lock: unknown, name: string, expected: string): void {
  if (!isRecord(lock) || !isRecord(lock.importers) || !isRecord(lock.importers['.'])) {
    throw new Error('desktop native profile has no package lock importer')
  }
  const importer = lock.importers['.']
  const dependencies = isRecord(importer.dependencies) ? importer.dependencies : {}
  const row = dependencies[name]
  if (!isRecord(row) || row.specifier !== expected || typeof row.version !== 'string'
    || row.version.split('(')[0] !== expected) {
    throw new Error(`desktop native package lock differs for ${name}`)
  }
}

type NativeDesktopMutation =
  | { readonly type: 'install'; readonly request: NativeDesktopInstallRequest }
  | { readonly type: 'remove'; readonly request: NativeDesktopPackageMutationRequest }
  | { readonly type: 'update'; readonly request: NativeDesktopUpdateRequest }
  | { readonly type: 'toggle'; readonly request: NativeDesktopToggleRequest }
  | { readonly type: 'disable-all'; readonly request: NativeDesktopMutationRequest }

const nativeErrorMessageKeys = {
  'wrong-profile': 'nativeWrongProfile',
  'invalid-request': 'nativeInvalidRequest',
  'stale-revision': 'nativeStaleRevision',
  'unsupported-module': 'nativeUnsupportedModule',
  'package-immutable': 'nativePackageImmutable',
  'not-found': 'nativeNotFound',
  'dependency-conflict': 'nativeDependencyConflict',
  busy: 'nativeBusy',
  'host-stop-failed': 'nativeHostStopFailed',
  'package-operation-failed': 'nativePackageOperationFailed',
  'profile-invalid': 'nativeProfileInvalid',
  'host-start-failed': 'nativeHostStartFailed',
  'recovery-required': 'nativeRecoveryError',
} satisfies Record<NativeDesktopErrorCode, string>

function backendProjection(state: DesktopBackendState, profileRecovery?: boolean): NativeDesktopBackendProjection {
  const recovery = profileRecovery ?? (state.phase === 'error' ? state.profileRecovery : undefined)
  return { phase: state.phase, ...recovery === undefined ? {} : { profileRecovery: recovery } }
}

function buildNativeCandidate(files: NativeProfileFiles, rows: readonly NativeSelectedRow[], mutation: NativeDesktopMutation,
  dependencies: Readonly<Record<string, string>>, runtime: DesktopRuntimeDescriptor, profileDir: string,
  runtimeDir: string, retained: ReadonlyMap<string, readonly NativeDesktopRetentionReason[]>): NativeCandidate {
  const profile = files.host
  const client = files.client
  const dependency = (name: string): string | undefined => dependencies[name]
  const isShared = (name: string): boolean => runtime.sharedPackages.some(row => row.name === name)
  const packageName = (name: string): string => {
    try { assertPackageName(name); return name }
    catch { throw new NativeDesktopOperationFailure('invalid-request') }
  }
  const version = (value: string): string => {
    try { assertVersion(value) } catch { throw new NativeDesktopOperationFailure('invalid-request') }
    if (valid(value) !== value) throw new NativeDesktopOperationFailure('invalid-request')
    return value
  }
  const hostScopes = new Set(profile.scopes.map(row => row.id))
  const noPackageOperation = (nextFiles: NativeProfileFiles, nextRows = rows, changed = true,
    validateBeforeStop = true, blockedBy?: readonly NativeDesktopInstallationKey[]): NativeCandidate => ({
    files: nextFiles, rows: nextRows, changed, validateBeforeStop,
    ...(blockedBy === undefined ? {} : { blockedBy }),
  })
  switch (mutation.type) {
    case 'install': {
      const name = packageName(mutation.request.packageName)
      const requestedVersion = version(mutation.request.version)
      if (isShared(name)) throw new NativeDesktopOperationFailure('package-immutable')
      const selectedVersion = dependency(name)
      if (selectedVersion !== undefined && selectedVersion !== requestedVersion) {
        throw new NativeDesktopOperationFailure('invalid-request')
      }
      const hostInstallations = [...profile.installations]
      const clientInstallations = [...client.installations]
      for (const intent of mutation.request.installations) {
        const existing = intent.target === 'host' ? hostInstallations : clientInstallations
        if (existing.some(row => row.id === intent.id)) throw new NativeDesktopOperationFailure('invalid-request')
        if (intent.target === 'host' && !hostScopes.has(intent.scope)) {
          throw new NativeDesktopOperationFailure('invalid-request')
        }
        if (intent.target === 'host') {
          hostInstallations.push({ id: intent.id, plugin: name, scope: intent.scope,
            ...intent.config === undefined ? {} : { config: intent.config },
            ...intent.enabled ? {} : { disabled: true } })
        } else {
          clientInstallations.push({ id: intent.id, plugin: name,
            ...intent.config === undefined ? {} : { config: intent.config },
            ...intent.enabled ? {} : { disabled: true } })
        }
      }
      const nextFiles: NativeProfileFiles = {
        host: { ...profile, installations: hostInstallations },
        client: { ...client, installations: clientInstallations },
      }
      if (selectedVersion !== undefined) {
        const nextRows = selectedRows(nextFiles, profileDir, runtimeDir, runtime)
        return noPackageOperation(nextFiles, nextRows)
      }
      return {
        files: nextFiles, rows, changed: true, validateBeforeStop: false,
        preflightFiles: files, preflightRows: rows,
        packageOperation: { args: ['add', `${name}@${requestedVersion}`, '--save-exact', '--ignore-scripts'],
          filesAfterInstall: nextFiles, writeFiles: true },
      }
    }
    case 'remove': {
      const name = packageName(mutation.request.packageName)
      if (isShared(name)) throw new NativeDesktopOperationFailure('package-immutable')
      if (dependency(name) === undefined) throw new NativeDesktopOperationFailure('not-found')
      const nextFiles: NativeProfileFiles = {
        host: { ...profile, installations: profile.installations.filter(row => row.plugin !== name) },
        client: { ...client, installations: client.installations.filter(row => row.plugin !== name) },
      }
      const nextRows = rows.filter(row => row.plugin !== name)
      return {
        ...noPackageOperation(nextFiles, nextRows),
        packageOperation: { args: ['remove', name, '--config.ignore-scripts=true'],
          filesAfterInstall: nextFiles, writeFiles: true },
      }
    }
    case 'update': {
      const name = packageName(mutation.request.packageName)
      const requestedVersion = version(mutation.request.version)
      if (isShared(name)) throw new NativeDesktopOperationFailure('package-immutable')
      const currentVersion = dependency(name)
      if (currentVersion === undefined) throw new NativeDesktopOperationFailure('not-found')
      if (currentVersion === requestedVersion) return noPackageOperation(files, rows, false)
      return {
        files, rows, changed: true, validateBeforeStop: false, preflightFiles: files, preflightRows: rows,
        packageOperation: { args: ['add', `${name}@${requestedVersion}`, '--save-exact', '--ignore-scripts'],
          filesAfterInstall: files, writeFiles: false },
      }
    }
    case 'toggle': {
      const { target, id } = mutation.request.key
      const key = rowKey(target, id)
      const selected = rows.find(row => rowKey(row.target, row.id) === key)
      if (selected === undefined) throw new NativeDesktopOperationFailure('not-found')
      if ((selected.disabled !== true) === mutation.request.enabled) return noPackageOperation(files, rows, false)
      if (!mutation.request.enabled) {
        if (retained.has(key)) {
          throw new NativeDesktopOperationFailure('dependency-conflict', false, undefined, [{ target, id: brandString(id) }])
        }
      }
      const nextHost = target === 'host' ? profile.installations.map(row => row.id === id
        ? toggleDisabled(row, mutation.request.enabled) : row) : profile.installations
      const nextClient = target === 'client' ? client.installations.map(row => row.id === id
        ? toggleDisabled(row, mutation.request.enabled) : row) : client.installations
      const nextFiles: NativeProfileFiles = {
        host: { ...profile, installations: nextHost },
        client: { ...client, installations: nextClient },
      }
      return noPackageOperation(nextFiles, selectedRows(nextFiles, profileDir, runtimeDir, runtime))
    }
    case 'disable-all': {
      const disable = <Row extends { readonly id: string; readonly disabled?: boolean }>(target: NativeDesktopTarget, row: Row): Row => {
        const key = rowKey(target, row.id)
        return row.disabled !== true && !retained.has(key) ? { ...row, disabled: true } : row
      }
      const nextFiles: NativeProfileFiles = {
        host: { ...profile, installations: profile.installations.map(row => disable('host', row)) },
        client: { ...client, installations: client.installations.map(row => disable('client', row)) },
      }
      const changed = JSON.stringify(nextFiles) !== JSON.stringify(files)
      return noPackageOperation(nextFiles, selectedRows(nextFiles, profileDir, runtimeDir, runtime), changed)
    }
    default:
      return mutation satisfies never
  }
}

function toggleDisabled<Row extends { readonly disabled?: boolean }>(row: Row, enabled: boolean): Row {
  if (!enabled) return { ...row, disabled: true }
  const { disabled: _disabled, ...rest } = row
  return rest as Row
}


/** Desktop npm project manager with direct writes and no rollback. */
export class DesktopProjectManager {
  private lockDescriptor: number | undefined
  private descriptor: DesktopRuntimeDescriptor | undefined

  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - absolute bundled Node.js and pnpm entry paths.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: DesktopRuntimeExecutables,
  ) {}

  /** Read the locked Native Desktop inventory without stopping the Host. */
  async listNativeModules(currentBackend: () => DesktopBackendState): Promise<NativeDesktopListOutcome> {
    try {
      const inventory = await this.withLock(async () => {
        this.descriptor = this.readRuntime()
        this.assertNativeProfile()
        if (existsSync(this.pendingPackages)) throw new NativeDesktopOperationFailure('recovery-required', true)
        const files = this.readNativeFiles()
        const rows = selectedRows(files, this.paths.profile, this.runtime.dsh, this.currentRuntime())
        const runtime = this.currentRuntime()
        const plan = await planNativeComposition(files, this.paths.profile, this.runtime.dsh, runtime,
          dirname(this.paths.root), 'metadata')
        const retained = plan.retained
        const lock = existsSync(join(this.paths.profile, 'pnpm-lock.yaml'))
          ? parseNativeLock(readFileSync(join(this.paths.profile, 'pnpm-lock.yaml'), 'utf8')) : undefined
        const dependencies = projectManifest(this.paths.profile).dependencies
        this.assertNativePackageState(plan.rows, dependencies, lock)
        const packages = new Map<string, NativeDesktopInstallationView[]>()
        for (const row of rows) {
          const key = rowKey(row.target, row.id)
          const reasons = retained.get(key) ?? []
          let canEnable = false
          let canDisable = row.disabled !== true && reasons.length === 0
          if (row.disabled) {
            const candidateFiles: NativeProfileFiles = row.target === 'host'
              ? { ...files, host: { ...files.host, installations: files.host.installations.map(value => value.id === row.id
                ? toggleDisabled(value, true) : value) } }
              : { ...files, client: { ...files.client, installations: files.client.installations.map(value => value.id === row.id
                ? toggleDisabled(value, true) : value) } }
            try {
              const candidatePlan = await planNativeComposition(candidateFiles, this.paths.profile,
                this.runtime.dsh, runtime, dirname(this.paths.root))
              this.assertNativePackageState(candidatePlan.rows, dependencies, lock)
              canEnable = true
            } catch { /* A disabled row stays visible with enabling unavailable. */ }
          } else if (canDisable) {
            const candidateFiles: NativeProfileFiles = row.target === 'host'
              ? { ...files, host: { ...files.host, installations: files.host.installations.map(value => value.id === row.id
                ? toggleDisabled(value, false) : value) } }
              : { ...files, client: { ...files.client, installations: files.client.installations.map(value => value.id === row.id
                ? toggleDisabled(value, false) : value) } }
            try {
              const candidatePlan = await planNativeComposition(candidateFiles, this.paths.profile,
                this.runtime.dsh, runtime, dirname(this.paths.root))
              this.assertNativePackageState(candidatePlan.rows, dependencies, lock)
            } catch { canDisable = false }
          }
          const view: NativeDesktopInstallationView = row.target === 'host'
            ? {
              target: 'host', id: brandString<NativeDesktopInstallationId>(row.id),
              scope: brandString<NativeDesktopScopeId>(row.scope ?? ''), packageName: row.plugin,
              enabled: row.disabled !== true, ...row.disabled === undefined ? {} : { disabled: row.disabled },
              hasConfig: row.hasConfig, availableTargets: row.metadata.entry.targets, nativeApiVersion: 1,
              canEnable, canDisable,
              ...reasons.length === 0 ? {} : { disableReasons: reasons },
            }
            : {
              target: 'client', id: brandString<NativeDesktopInstallationId>(row.id), packageName: row.plugin,
              enabled: row.disabled !== true, ...row.disabled === undefined ? {} : { disabled: row.disabled },
              hasConfig: row.hasConfig, availableTargets: row.metadata.entry.targets, nativeApiVersion: 1,
              canEnable, canDisable,
              ...reasons.length === 0 ? {} : { disableReasons: reasons },
            }
          const list = packages.get(row.plugin) ?? []
          list.push(view)
          packages.set(row.plugin, list)
        }
        const inventoryPackages = [...packages].map(([name, installations]): NativeDesktopPackageView => {
          const metadata = rows.find(row => row.plugin === name)?.metadata
          if (metadata === undefined) throw new Error(`desktop native inventory lost package ${name}`)
          const managedBy = this.currentRuntime().sharedPackages.some(shared => shared.name === name) ? 'signed-runtime' : 'profile'
          const manageable = managedBy === 'profile' && Object.hasOwn(dependencies, name)
          return {
            packageName: name, packageVersion: metadata.version, managedBy,
            packageCapabilities: { canRemovePackage: manageable, canUpdatePackage: manageable },
            installations,
          }
        }).sort((left, right) => left.packageName.localeCompare(right.packageName))
        const scopes: NativeDesktopScopeView[] = files.host.scopes.map(scope => ({
          id: brandString<NativeDesktopScopeId>(scope.id),
          ...scope.parent === undefined ? {} : { parent: brandString<NativeDesktopScopeId>(scope.parent) },
        }))
        return {
          runtime: 'native' as const,
          revision: this.nativeRevision(files, rows),
          scopes, packages: inventoryPackages,
        } satisfies NativeDesktopInventory
      })
      return { status: 'listed', inventory }
    } catch (error) {
      const failure = this.nativeFailure(error, false)
      const state = currentBackend()
      return {
        status: failure.afterHandoff || existsSync(this.pendingPackages) ? 'recovery-required' : 'refused',
        error: this.nativeError(failure, state),
      }
    }
  }

  /** @returns Whether the installed Desktop project selects the Native profile runtime. */
  supportsNativeModuleManagement(): boolean {
    return existsSync(this.paths.profile) && profileDirectoryRuntime(this.paths.profile) === 'native'
  }

  /** Return a safe Native operation refusal for IPC requests rejected before manager admission. */
  refuseNativeMutation(code: NativeDesktopErrorCode, state: DesktopBackendState): NativeDesktopMutationOutcome {
    return { status: 'refused', error: this.nativeError(new NativeDesktopOperationFailure(code), state) }
  }

  /** Return a safe Native inventory refusal for IPC requests rejected before manager admission. */
  refuseNativeList(code: NativeDesktopErrorCode, state: DesktopBackendState): NativeDesktopListOutcome {
    return { status: 'refused', error: this.nativeError(new NativeDesktopOperationFailure(code), state) }
  }

  /** Apply one Native Desktop package or installation mutation under the profile lock. */
  async mutateNativeModules(mutation: NativeDesktopMutation, hooks: DesktopProjectHooks,
    currentBackend: () => DesktopBackendState): Promise<NativeDesktopMutationOutcome> {
    let afterHandoff = false
    try {
      const revision = await this.withLock(async () => {
        this.descriptor = this.readRuntime()
        this.assertNativeProfile()
        if (existsSync(this.pendingPackages)) throw new NativeDesktopOperationFailure('recovery-required', true)
        const files = this.readNativeFiles()
        const rows = selectedRows(files, this.paths.profile, this.runtime.dsh, this.currentRuntime())
        const currentRevision = this.nativeRevision(files, rows)
        if (mutation.request.expectedRevision !== currentRevision) {
          throw new NativeDesktopOperationFailure('stale-revision', false, currentRevision)
        }
        const manifest = projectManifest(this.paths.profile)
        const lockPath = join(this.paths.profile, 'pnpm-lock.yaml')
        const lock = existsSync(lockPath) ? parseNativeLock(readFileSync(lockPath, 'utf8')) : undefined
        const metadataOnly = mutation.type === 'disable-all'
          || mutation.type === 'toggle' && !mutation.request.enabled
        const plan = await planNativeComposition(files, this.paths.profile, this.runtime.dsh,
          this.currentRuntime(), dirname(this.paths.root), metadataOnly ? 'metadata' : 'strict')
        this.assertNativePackageState(plan.rows, manifest.dependencies, lock)
        const next = this.nativeCandidate(files, rows, mutation, manifest.dependencies, plan.retained)
        if (!next.changed) return currentRevision
        if (next.validateBeforeStop) {
          try { await validateNativeComposition(next.files, this.paths.profile, this.runtime.dsh,
            this.currentRuntime(), dirname(this.paths.root)) }
          catch { throw new NativeDesktopOperationFailure('dependency-conflict', false, undefined, next.blockedBy) }
        } else {
          try { await validateNativeComposition(files, this.paths.profile, this.runtime.dsh,
            this.currentRuntime(), dirname(this.paths.root)) }
          catch { throw new NativeDesktopOperationFailure('profile-invalid') }
        }
        try { await hooks.beforeChange() }
        catch { throw new NativeDesktopOperationFailure('host-stop-failed') }
        afterHandoff = true
        try {
          if (next.packageOperation !== undefined) {
            const operation = next.packageOperation
            unlinkDesktopHostPackages(this.paths.profile)
            try {
              await this.runPnpm(this.paths.profile, operation.args)
              linkDesktopHostPackages(this.paths.profile, this.runtime.dsh, this.currentRuntime())
              const afterInstallFiles = operation.filesAfterInstall ?? next.files
              let afterInstallPlan: NativePlanningResult
              try { afterInstallPlan = await planNativeComposition(afterInstallFiles, this.paths.profile,
                this.runtime.dsh, this.currentRuntime(), dirname(this.paths.root)) }
              catch { throw new NativeDesktopOperationFailure('unsupported-module', true) }
              const installedDependencies = projectManifest(this.paths.profile).dependencies
              const installedLockPath = join(this.paths.profile, 'pnpm-lock.yaml')
              const installedLock = existsSync(installedLockPath)
                ? parseNativeLock(readFileSync(installedLockPath, 'utf8')) : undefined
              this.assertNativePackageState(afterInstallPlan.rows, installedDependencies, installedLock)
              try { await validateNativeComposition(afterInstallFiles, this.paths.profile, this.runtime.dsh,
                this.currentRuntime(), dirname(this.paths.root)) }
              catch { throw new NativeDesktopOperationFailure('unsupported-module', true) }
              if (operation.writeFiles) this.writeNativeFiles(next.files)
              await this.finishPackageOperation(this.paths.profile)
            } finally {
              linkDesktopHostPackages(this.paths.profile, this.runtime.dsh, this.currentRuntime())
            }
          } else {
            this.writeNativeFiles(next.files)
          }
        } catch (error) {
          if (error instanceof NativeDesktopOperationFailure) throw error
          const code: NativeDesktopErrorCode = existsSync(this.pendingPackages)
            ? 'package-operation-failed' : 'recovery-required'
          throw new NativeDesktopOperationFailure(code, true)
        }
        try { await hooks.afterChange() }
        catch { throw new NativeDesktopOperationFailure('host-start-failed', true) }
        const committedFiles = this.readNativeFiles()
        const committedRows = selectedRows(committedFiles, this.paths.profile, this.runtime.dsh, this.currentRuntime())
        return this.nativeRevision(committedFiles, committedRows)
      })
      return { status: 'applied', revision, backend: backendProjection(currentBackend()) }
    } catch (error) {
      const failure = this.nativeFailure(error, afterHandoff)
      const state = currentBackend()
      return {
        status: failure.afterHandoff || existsSync(this.pendingPackages)
          || (failure.code === 'host-stop-failed' && state.phase !== 'ready') ? 'recovery-required' : 'refused',
        error: this.nativeError(failure, state),
      }
    }
  }

  private assertNativeProfile(): void {
    if (!existsSync(this.paths.profile) || profileDirectoryRuntime(this.paths.profile) !== 'native'
      || profileDirectoryReloadMode(this.paths.profile) !== 'startup') {
      throw new NativeDesktopOperationFailure('wrong-profile')
    }
    projectManifest(this.paths.profile)
    readNativeProfile({ profile: 'desktop', profileDir: this.paths.profile, patchFiles: [] })
  }

  private readNativeFiles(): NativeProfileFiles {
    const host = readNativeProfile({ profile: 'desktop', profileDir: this.paths.profile, patchFiles: [] })
    const client = parseNativeClientProfile(readJson(join(this.paths.profile, 'rsh.client.json')))
    return { host, client }
  }

  private writeNativeFiles(files: NativeProfileFiles): void {
    writeJson(join(this.paths.profile, 'rsh.profile.json'), files.host)
    writeJson(join(this.paths.profile, 'rsh.client.json'), files.client)
  }

  private nativeRevision(files: NativeProfileFiles, rows: readonly NativeSelectedRow[]): NativeDesktopRevision {
    const hash = createHash('sha256')
    const add = (name: string, path: string): void => {
      hash.update(name).update('\0')
      if (!existsSync(path)) { hash.update('absent\0'); return }
      const bytes = readFileSync(path)
      hash.update('present\0').update(String(bytes.byteLength)).update('\0').update(bytes).update('\0')
    }
    hash.update(desktopRuntimeId(this.currentRuntime())).update('\0')
    const revisionFiles = [
      ['package.json', join(this.paths.profile, 'package.json')],
      ['pnpm-lock.yaml', join(this.paths.profile, 'pnpm-lock.yaml')],
      ['rsh.profile.json', join(this.paths.profile, 'rsh.profile.json')],
      ['rsh.client.json', join(this.paths.profile, 'rsh.client.json')],
      ['desktop-runtime-state.json', join(this.paths.profile, 'desktop-runtime-state.json')],
    ] as const
    for (const [name, path] of revisionFiles) add(name, path)
    for (const path of [...new Set(rows.map(row => row.metadata.manifestPath))].sort()) add(`native-package:${path}`, path)
    // Keep the validated values in the revision calculation even if an editor rewrites equivalent JSON bytes.
    hash.update(JSON.stringify([files.host.scopes, files.host.installations, files.client.installations]))
    return brandString<NativeDesktopRevision>(hash.digest('hex'))
  }

  private nativeCandidate(files: NativeProfileFiles, rows: readonly NativeSelectedRow[], mutation: NativeDesktopMutation,
    dependencies: Readonly<Record<string, string>>,
    retained: ReadonlyMap<string, readonly NativeDesktopRetentionReason[]>): NativeCandidate {
    return buildNativeCandidate(files, rows, mutation, dependencies, this.currentRuntime(), this.paths.profile,
      this.runtime.dsh, retained)
  }

  private assertNativePackageState(rows: readonly NativeSelectedRow[], dependencies: Readonly<Record<string, string>>,
    lock: unknown): void {
    const shared = new Set(this.currentRuntime().sharedPackages.map(row => row.name))
    const packages = new Map<string, NativePackageMetadata>()
    for (const row of rows) if (!shared.has(row.plugin)) packages.set(row.plugin, row.metadata)
    for (const [name, metadata] of packages) {
      const dependency = dependencies[name]
      if (dependency === undefined) throw new NativeDesktopOperationFailure('profile-invalid')
      if (lock === undefined) throw new NativeDesktopOperationFailure('recovery-required', true)
      try { assertLockedVersion(lock, name, dependency) }
      catch { throw new NativeDesktopOperationFailure('recovery-required', true) }
      if (metadata.version !== dependency) throw new NativeDesktopOperationFailure('recovery-required', true)
    }
  }

  private nativeFailure(error: unknown, afterHandoff: boolean): NativeDesktopOperationFailure {
    if (error instanceof NativeDesktopOperationFailure) return error
    if (error instanceof Error && error.message.includes('another package transaction is active')) {
      return new NativeDesktopOperationFailure('busy')
    }
    return new NativeDesktopOperationFailure(existsSync(this.pendingPackages) ? 'recovery-required' : 'profile-invalid',
      afterHandoff || existsSync(this.pendingPackages))
  }

  private nativeError(failure: NativeDesktopOperationFailure, state: DesktopBackendState) {
    const profileRecovery = existsSync(this.pendingPackages) || (state.phase === 'error' && state.profileRecovery)
    return {
      code: failure.code,
      messageKey: nativeErrorMessageKeys[failure.code],
      backend: backendProjection(state, profileRecovery),
      ...failure.currentRevision === undefined ? {} : { currentRevision: failure.currentRevision },
      ...failure.blockedBy === undefined ? {} : { blockedBy: failure.blockedBy },
    }
  }

  /** Read the active desktop plugin inventory. */
  listPlugins(): readonly DesktopPluginRecord[] {
    if (!existsSync(this.paths.profile)) return []
    this.assertLegacyPluginManagement()
    return pluginRecords(this.paths.profile)
  }

  /** @returns Whether the current profile supports compatibility plugin operations. */
  supportsLegacyPluginManagement(): boolean {
    return profileDirectoryRuntime(this.paths.profile) === 'legacy'
  }

  private assertLegacyPluginManagement(): void {
    if (!this.supportsLegacyPluginManagement()) throw new Error('desktop project: native profiles do not support compatibility plugin management')
  }

  /**
   * Reinitialize the profile, deleting configuration and third-party packages without a backup.
   * @param hooks - Stop the Host before resetting files; restart after preparation succeeds.
   * @returns Completion of reset; the held lock and shared product data are preserved.
   */
  async resetConfiguration(hooks: DesktopProjectHooks): Promise<void> {
    await this.withLock(async () => {
      await hooks.beforeChange()
      this.descriptor = this.readRuntime()
      for (const entry of readdirSync(this.paths.profile, { withFileTypes: true })) {
        const path = join(this.paths.profile, entry.name)
        if (path === this.paths.lock) continue
        if (entry.isDirectory()) removeOwnedDirectory(path)
        else unlinkSync(path)
      }
      createPluginProfile(this.paths.profile)
      this.prepareProfile(this.paths.profile)
      await hooks.afterChange()
    })
  }

  /** Read the dsh version supplied by this application's verified resources. */
  dshVersion(): string {
    return this.currentRuntime().release.version
  }

  /** Read the release most recently applied to the active profile. */
  releaseVersion(): string {
    const state = readDesktopProfileState(this.paths.profile)
    if (state === undefined) throw new Error('desktop project: active profile has no runtime state')
    return state.version
  }

  /** Reject a profile whose dependency links were prepared for another runtime. */
  assertProfileRuntime(projectDir: string): void {
    if (existsSync(this.pendingPackages)) throw new Error('desktop project: package preparation is incomplete; retry startup')
    if (readDesktopProfileState(projectDir)?.runtimeId !== desktopRuntimeId(this.currentRuntime())) {
      throw new Error('desktop project: profile does not match this application runtime')
    }
  }

  /** @returns Whether application resources support profile recovery. */
  canRecoverProfile(): boolean {
    return this.descriptor !== undefined && existsSync(this.runtime.node) && existsSync(this.runtime.dsh)
  }

  private get pendingPackages(): string { return join(this.paths.profile, 'desktop-packages-pending') }

  private currentRuntime(): DesktopRuntimeDescriptor {
    if (this.descriptor === undefined) throw new Error('desktop project: runtime metadata has not been loaded')
    return this.descriptor
  }

  private readRuntime(): DesktopRuntimeDescriptor {
    this.descriptor = undefined
    return readDesktopRuntime(this.runtime.dsh)
  }

  private prepareProfile(projectDir: string): void {
    const runtime = this.currentRuntime()
    if (profileDirectoryRuntime(projectDir) === 'native') {
      projectManifest(projectDir)
      if (profileDirectoryReloadMode(projectDir) !== 'startup') throw new Error('desktop project: native profiles require configReload startup')
      readNativeProfile({ profile: 'desktop', profileDir: projectDir, patchFiles: [] })
      linkDesktopHostPackages(projectDir, this.runtime.dsh, runtime)
      return
    }
    linkDesktopHostPackages(projectDir, this.runtime.dsh, runtime)
    validateDesktopPluginGraph(projectDir, this.runtime.dsh, runtime, profilePluginNames(projectDir))
  }

  /** Read release metadata and reconcile its external profile without installing core packages. */
  async applyRelease(): Promise<boolean> {
    return this.withLock(async () => {
      const target = this.readRuntime()
      this.descriptor = target
      const previous = readDesktopProfileState(this.paths.profile)
      if (!existsSync(this.pendingPackages) && previous?.runtimeId === desktopRuntimeId(target)
        && previous.lockHash === desktopPluginLockHash(this.paths.profile)
        && previous.links.length === target.sharedPackages.length
        && previous.links.every(link => existsSync(link.target)
          && existsSync(join(this.paths.profile, 'node_modules', link.name))
          && realpathSync.native(link.target) === realpathSync.native(join(this.runtime.dsh, 'node_modules', link.name)))) {
        return false
      }
      if (previous === undefined && profileDirectoryRuntime(this.paths.profile) === 'legacy') createPluginProfile(this.paths.profile)
      await this.reconcileProfile(this.paths.profile, previous)
      return true
    })
  }

  /** Modify the current profile while its backend is stopped; failures retain partial changes. */
  async mutate(mutation: DesktopProjectMutation, hooks: DesktopProjectHooks): Promise<void> {
    await this.withLock(async () => {
      this.currentRuntime()
      if (!existsSync(this.paths.profile)) throw new Error('desktop project: active profile is not installed')
      this.assertLegacyPluginManagement()
      await hooks.beforeChange()
      if (mutation.type === 'plugins-disable-all') {
        const manifest = projectManifest(this.paths.profile)
        writeJson(join(this.paths.profile, 'package.json'), {
          ...manifest,
          dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: [...DESKTOP_PROFILE_BUNDLES] } },
        })
        this.prepareProfile(this.paths.profile)
        await hooks.afterChange()
        return
      }
      const previous = readDesktopProfileState(this.paths.profile)
      const packagesChanged = mutation.type !== 'plugin-toggle'
      if (packagesChanged) unlinkDesktopHostPackages(this.paths.profile)
      try {
        await this.applyMutation(this.paths.profile, mutation)
      } finally {
        if (packagesChanged) linkDesktopHostPackages(this.paths.profile, this.runtime.dsh, this.currentRuntime())
      }
      await this.reconcileProfile(this.paths.profile, previous, packagesChanged)
      await hooks.afterChange()
    })
  }

  private async reconcileProfile(projectDir: string, previous: DesktopProfileState | undefined, packagesChanged = false): Promise<void> {
    const target = this.currentRuntime()
    const rebuild = (!packagesChanged && existsSync(this.pendingPackages))
      || (previous !== undefined && (profileDirectoryRuntime(projectDir) === 'native'
        ? Object.keys(projectManifest(projectDir).dependencies).length : pluginRecords(projectDir).length) > 0
      && (previous.nodeVersion !== target.release.nodeVersion || previous.platform !== target.platform || previous.arch !== target.arch))
    if (rebuild) {
      writeFileSync(this.pendingPackages, '')
      unlinkDesktopHostPackages(projectDir)
      removeOwnedDirectory(join(projectDir, 'node_modules'))
      await this.runPnpm(projectDir, ['install', '--frozen-lockfile', '--ignore-scripts'])
    }
    if (rebuild || packagesChanged) await this.finishPackageOperation(projectDir)
    else this.prepareProfile(projectDir)
  }

  private async finishPackageOperation(projectDir: string): Promise<void> {
    this.prepareProfile(projectDir)
    await this.runPnpm(projectDir, ['rebuild', '--pending'])
    this.prepareProfile(projectDir)
    unlinkSync(this.pendingPackages)
  }

  private async applyMutation(projectDir: string, mutation: Exclude<DesktopProjectMutation, { type: 'plugins-disable-all' }>): Promise<void> {
    switch (mutation.type) {
      case 'plugin-add': {
        const requestedName = packageNameFromSpec(mutation.spec)
        if (this.currentRuntime().sharedPackages.some(entry => entry.name === requestedName)) {
          throw new Error(`desktop project: cannot install host-owned package ${requestedName}`)
        }
        await this.runPnpm(projectDir, ['add', mutation.spec, '--save-exact', '--ignore-scripts'])
        const installed = { ...inspectPlugin(projectDir, requestedName), enabled: true }
        const current = pluginRecords(projectDir).filter(plugin => plugin.name !== installed.name)
        writeProfilePlugins(
          projectDir,
          [...current, installed].sort((left, right) => left.name.localeCompare(right.name)),
        )
        return
      }
      case 'plugin-remove': {
        assertPackageName(mutation.name)
        if (!Object.hasOwn(projectManifest(projectDir).dependencies, mutation.name)) {
          throw new Error(`desktop project: plugin ${JSON.stringify(mutation.name)} is not installed`)
        }
        const remaining = pluginRecords(projectDir).filter(plugin => plugin.name !== mutation.name)
        await this.runPnpm(projectDir, ['remove', mutation.name, '--config.ignore-scripts=true'])
        writeProfilePlugins(projectDir, remaining)
        return
      }
      case 'plugin-update':
        assertPackageName(mutation.name)
        assertVersion(mutation.version)
        if (!Object.hasOwn(projectManifest(projectDir).dependencies, mutation.name)) {
          throw new Error(`desktop project: plugin ${JSON.stringify(mutation.name)} is not installed`)
        }
        await this.runPnpm(projectDir, ['add', `${mutation.name}@${mutation.version}`, '--save-exact', '--ignore-scripts'])
        {
          const installed = inspectPlugin(projectDir, mutation.name)
          writeProfilePlugins(
            projectDir,
            pluginRecords(projectDir).map(plugin => plugin.name === installed.name ? installed : plugin),
          )
        }
        return
      case 'plugin-toggle': {
        assertPackageName(mutation.name)
        const plugins = pluginRecords(projectDir)
        if (!plugins.some(plugin => plugin.name === mutation.name)) throw new Error(`desktop project: plugin ${mutation.name} is not installed`)
        writeProfilePlugins(projectDir, plugins.map(plugin => (
          plugin.name === mutation.name ? { ...plugin, enabled: mutation.enabled } : plugin
        )))
        return
      }
      default:
        mutation satisfies never
    }
  }

  private async runPnpm(projectDir: string, args: readonly string[]): Promise<void> {
    const [command, ...commandArgs] = args
    if (command === undefined) throw new Error('desktop project: pnpm command is required')
    for (const path of [this.paths.root, this.paths.pnpm.store, this.paths.pnpm.cache,
      this.paths.pnpm.state, this.paths.pnpm.config, this.paths.pnpm.home]) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    const npmrc = join(this.paths.pnpm.config, 'npmrc')
    if (!existsSync(npmrc)) writeFileSync(npmrc, '', { mode: 0o600 })
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
      name !== 'NODE_OPTIONS' && name !== 'NODE_PATH' && !/^DSH_DESKTOP_/u.test(name) && !/^(?:npm|pnpm|corepack)_/iu.test(name)
    )))
    writeFileSync(this.pendingPackages, '')
    await new Promise<void>((settle, reject) => {
      const child = spawn(this.runtime.node, [
        this.runtime.pnpm,
        `--config.registry=${DESKTOP_REGISTRY}`,
        `--config.store-dir=${this.paths.pnpm.store}`,
        '--config.enable-global-virtual-store=false',
        `--config.userconfig=${npmrc}`,
        command,
        ...commandArgs,
      ], {
        cwd: projectDir,
        env: {
          ...inherited,
          COREPACK_HOME: this.paths.pnpm.home,
          NPM_CONFIG_REGISTRY: DESKTOP_REGISTRY,
          NPM_CONFIG_STORE_DIR: this.paths.pnpm.store,
          NPM_CONFIG_USERCONFIG: npmrc,
          PATH: `${dirname(this.runtime.node)}${delimiter}${process.env.PATH ?? ''}`,
          PNPM_HOME: this.paths.pnpm.home,
          XDG_CACHE_HOME: this.paths.pnpm.cache,
          XDG_CONFIG_HOME: this.paths.pnpm.config,
          XDG_STATE_HOME: this.paths.pnpm.state,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let failure: Error | undefined
      let diagnostics = ''
      let completed = false
      const appendDiagnostics = (chunk: string): void => {
        diagnostics = (diagnostics + chunk).slice(-MAX_PNPM_DIAGNOSTIC_BYTES)
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', appendDiagnostics)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', appendDiagnostics)
      const complete = (settleChild: () => void): void => {
        if (completed) return
        completed = true
        try {
          this.writeLockOwner(process.pid)
        } catch (error) {
          reject(errorOf(error, 'desktop project: failed to return the package transaction lock to Electron'))
          return
        }
        settleChild()
      }
      child.once('error', (error) => { failure = error })
      child.once('close', (code, signal) => {
        complete(() => {
          if (failure !== undefined) { reject(failure); return }
          if (code === 0) {
            settle()
            return
          }
          reject(new Error(
            `desktop project: pnpm exited with ${String(code ?? signal)}${diagnostics.trim() === '' ? '' : `: ${diagnostics.trim()}`}`,
          ))
        })
      })
      try {
        if (child.pid === undefined) throw new Error('desktop project: pnpm did not report a process id')
        this.writeLockOwner(child.pid)
      } catch (error) {
        failure = errorOf(error, 'desktop project: failed to assign the package transaction lock to pnpm')
        child.kill('SIGKILL')
      }
    })
  }

  private writeLockOwner(pid: number): void {
    const descriptor = this.lockDescriptor
    if (descriptor === undefined) throw new Error('desktop project: package transaction lost its lock')
    const content = Buffer.from(`${String(pid)}\n`)
    ftruncateSync(descriptor, 0)
    writeSync(descriptor, content, 0, content.byteLength, 0)
    fsyncSync(descriptor)
  }

  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    mkdirSync(this.paths.profile, { recursive: true, mode: 0o700 })
    if (lstatSync(this.paths.profile).isSymbolicLink()) throw new Error('desktop project: profile directory must not be a link')
    let descriptor: number
    try {
      descriptor = openSync(this.paths.lock, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(this.paths.lock)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: package transaction lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(this.paths.lock, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another package transaction is active')
        unlinkSync(this.paths.lock)
        descriptor = openSync(this.paths.lock, 'wx', 0o600)
      } else {
        throw error
      }
    }
    try {
      this.lockDescriptor = descriptor
      this.writeLockOwner(process.pid)
      return await operation()
    } finally {
      this.lockDescriptor = undefined
      closeSync(descriptor)
      unlinkSync(this.paths.lock)
    }
  }
}

/** Create build-only project metadata for materializing the signed runtime. */
export function createRuntimeProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(projectDir, release.version)
  const manifest: DesktopProjectManifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(
    join(projectDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [DSH_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
}

/** Create the first external plugin profile without running a package manager. */
export function createPluginProfile(projectDir: string): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  writeJson(join(projectDir, 'package.json'), {
    name: PROJECT_NAME, private: true, version: '0.0.0', dependencies: {},
    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  } satisfies DesktopProjectManifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
}
