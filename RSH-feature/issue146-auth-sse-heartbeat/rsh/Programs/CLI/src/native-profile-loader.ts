/** Native package discovery and installation planning for a selected dsh profile. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import type { NativePresetFolderSummary } from '@deepseek-ai/dsh-agent-presets/native'
import {
  NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry,
  type InstallationRequest, type NativeApplication, type NativeEntryManifest, type NativePackageInstallation,
  type NativePackageProvenance, type NativePlugin,
} from '@deepseek-ai/dsh-native-runtime'
import { launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { loadLayeredEnv } from '@deepseek-ai/dsh-launch-environment/layers'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { nativeSdkChildRuntimeLauncher } from './native-sdk-child-runtime-launcher.ts'
import { nativeAcpChildRuntimeLauncher } from './native-acp-child-runtime-launcher.ts'
import {
  applyNativeProfilePatches, parseNativeProfileConfig, profileDirectoryRuntime, profileRuntime, type NativeProfileConfig,
} from './native-profile-config.ts'

interface SelectedPackage {
  row: NativeProfileConfig['installations'][number]
  entry: NativeEntryManifest
  entryPath: string
  package: NativePackageProvenance
}

/** Loaded native composition before activation; the caller owns start and stop. */
export interface LoadedNativeProfile {
  readonly host: NativeHost
  readonly profile: NativeProfileConfig
  readonly requests: ReadonlyMap<string, InstallationRequest>
}

interface LoadedProfileState {
  /** Running Host read by the plugin inventory; reloads keep the first Host. */
  readonly inventory: { host: NativeHost | undefined }
  readonly scopes: ReadonlyMap<string, NativeScope>
  readonly captureRequest: InstallationRequest | undefined
  readonly onApplication: ((application: NativeApplication) => void) | undefined
  readonly auxiliaryRequests: ReadonlyMap<string, InstallationRequest>
  readonly plan: ReturnType<typeof resolveInstallation>
}

const loadedProfileStates = new WeakMap<LoadedNativeProfile, LoadedProfileState>()

const nativeChildLaunchers = [
  { package: '@deepseek-ai/dsh-sdk-child', service: 'sdkChildRuntimeLauncher', plugin: nativeSdkChildRuntimeLauncher },
  { package: '@deepseek-ai/dsh-acp-child', service: 'acpChildRuntimeLauncher', plugin: nativeAcpChildRuntimeLauncher },
] as const

/** One provider visible to the native CLI profile loader. */
export interface NativeProfileServiceProvider {
  /** Scope that owns this Provider. */
  readonly scope: string
  /** Services declared by the selected plugin entry. */
  readonly provides: readonly string[]
}

/** One selected installation used to derive an SDK or ACP child route. */
export interface NativeProfileChildRouteProvider {
  /** Installation identity in the native profile. */
  readonly id: string
  /** Selected package name. */
  readonly plugin: string
  /** Scope that owns this Provider. */
  readonly scope: string
  /** Persisted installation configuration, when present. */
  readonly config?: unknown
  /** Services declared by the selected package entry. */
  readonly provides: readonly string[]
}

/** One loader-owned Provider added beside selected profile installations. */
export interface NativeProfileAuxiliaryProvider {
  /** Stable key used by the loader to retain this request during reload. */
  readonly key: string
  /** Profile scope that owns this Provider. */
  readonly scope: string
  /** Actual Provider declaration used by native Host planning. */
  readonly plugin: NativePlugin
}

/** One profile row that the CLI adds for an SDK or ACP child runtime. */
export interface NativeProfileChildSupportInstallation {
  /** Reserved identity assigned by the profile loader. */
  readonly id: string
  /** Scope that owns the child and its missing support Provider. */
  readonly scope: string
  /** Package selected by the profile loader for the missing service. */
  readonly plugin: string
  /** Service the package must provide. */
  readonly service: 'childConnection' | 'sandbox'
}

/** Create the root-scoped Provider that exposes the retained Host's read-only inventory.
 * @param getHost - returns the retained Host whose diagnostics back this inventory.
 * @returns the exact Provider declaration used by native profile loading.
 */
export function createNativePluginInventoryProvider(getHost: () => NativeHost | undefined): NativePlugin {
  return {
    apiVersion: 1, name: 'dsh-native-plugin-inventory', targets: ['host'], requires: [], provides: ['pluginInventory'],
    resolve: () => (context) => {
      const providerScope = context.scope
      context.provide('pluginInventory', {
        list: () => getHost()?.diagnostics() ?? [],
        packages: (scope): readonly NativePackageInstallation[] => {
          if (!providerScope.contains(scope)) throw new Error('native profile inventory cannot query an unrelated scope')
          const ancestry = new Set<string>()
          for (let current: NativeScope | undefined = scope; current !== undefined; current = current.parent) {
            ancestry.add(current.id)
          }
          return (getHost()?.diagnostics() ?? []).flatMap((diagnostic) => {
            if (diagnostic.state !== 'ready' || diagnostic.package === undefined || !ancestry.has(diagnostic.scope)) return []
            return [{ id: diagnostic.id, scope: diagnostic.scope, package: diagnostic.package }]
          })
        },
      })
    },
  }
}

/** Select the SDK or ACP child launcher Providers that native profile loading must add.
 * @param profile - profile after preset and child-support installation expansion.
 * @param selected - active Host Providers from selected package entries.
 * @param disabledProvider - returns a disabled package that blocks the missing child service, if any.
 * @returns one actual launcher Provider for each child runtime and scope.
 */
export function nativeProfileChildRuntimeProviders(profile: NativeProfileConfig,
  selected: readonly NativeProfileServiceProvider[],
  disabledProvider: (ancestry: readonly string[], service: string) => string | undefined,
): readonly NativeProfileAuxiliaryProvider[] {
  const providers = new Map<string, NativeProfileAuxiliaryProvider>()
  for (const row of profile.installations) {
    if (row.disabled === true) continue
    const child = nativeChildLaunchers.find(candidate => candidate.package === row.plugin)
    if (child === undefined) continue
    const ancestry = scopeAncestry(profile, row.scope)
    if (ancestry.some(scope => selected.some(provider => provider.scope === scope && provider.provides.includes(child.service)))) continue
    const disabledPlugin = disabledProvider(ancestry, child.service)
    if (disabledPlugin !== undefined) {
      throw new Error(`native profile disables ${disabledPlugin} in the child scope ancestry but no ${child.service} Provider is available`)
    }
    const key = `native-child-runtime-launcher:${child.service}:${row.scope}`
    providers.set(key, { key, scope: row.scope, plugin: child.plugin })
  }
  return [...providers.values()]
}

/** Select the ordinary support package rows the CLI adds for child runtimes.
 * @param profile - profile after preset expansion.
 * @param selected - active Host Providers already selected by the profile.
 * @param disabledProvider - returns a disabled package that blocks a missing service.
 * @returns only the scoped support rows absent from each child's visible Provider ancestry.
 */
export function nativeProfileChildSupportInstallations(profile: NativeProfileConfig,
  selected: readonly NativeProfileServiceProvider[],
  disabledProvider: (ancestry: readonly string[], service: string) => string | undefined,
): readonly NativeProfileChildSupportInstallation[] {
  const childScopes = new Set(profile.installations.flatMap((row) => {
    if (row.disabled === true) return []
    const child = nativeChildLaunchers.find(candidate => candidate.package === row.plugin)
    if (child === undefined || scopeAncestry(profile, row.scope)
      .some(scope => selected.some(provider => provider.scope === scope && provider.provides.includes(child.service)))) return []
    return [row.scope]
  }))
  const additions = [
    { service: 'childConnection', id: 'subprocess', plugin: '@deepseek-ai/dsh-subprocess-local' },
    { service: 'sandbox', id: 'sandbox', plugin: '@deepseek-ai/dsh-sandbox-local' },
  ] as const
  const providers = [...selected]
  const installations: NativeProfileChildSupportInstallation[] = []
  for (const scope of childScopes) {
    const ancestry = scopeAncestry(profile, scope)
    for (const addition of additions) {
      if (ancestry.some(parent => providers.some(provider => provider.scope === parent
        && provider.provides.includes(addition.service)))) continue
      const disabled = disabledProvider(ancestry, addition.service)
      if (disabled !== undefined) {
        throw new Error(`native profile disables ${disabled} in the child scope ancestry but no ${addition.service} Provider is available`)
      }
      const id = `native-child-runtime/${scope}/${addition.id}`
      if (profile.installations.some(row => row.id === id)) {
        throw new Error(`native profile installation id ${id} is reserved for child runtime support`)
      }
      installations.push({ id, scope, plugin: addition.plugin, service: addition.service })
      providers.push({ scope, provides: [addition.service] })
    }
  }
  return installations
}

function jsonFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) as unknown }
  catch (error) { throw new Error(`native profile cannot read JSON ${path}`, { cause: error }) }
}

function refuseLegacyPatch(path: string): void {
  if (!existsSync(path)) return
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  const content = lines.filter(line => !line.trimStart().startsWith('#')).join('').trim()
  if (content !== '' && content !== '[]') {
    throw new Error(`native profile cannot apply Cordis patch ${path}; migrate or remove that layer explicitly`)
  }
}

function scopesOf(profile: NativeProfileConfig, previous?: LoadedNativeProfile): Map<string, NativeScope> {
  const declarations = new Map(profile.scopes.map(scope => [scope.id, scope]))
  const priorDeclarations = new Map(previous?.profile.scopes.map(scope => [scope.id, scope]) ?? [])
  const priorScopes = previous === undefined ? undefined : loadedProfileStates.get(previous)?.scopes
  const scopes = new Map<string, NativeScope>()
  const create = (id: string): NativeScope => {
    const existing = scopes.get(id)
    if (existing !== undefined) return existing
    const row = declarations.get(id)
    if (row === undefined) throw new Error(`native profile lost scope ${id}`)
    const parent = row.parent === undefined ? undefined : create(row.parent)
    const prior = priorScopes?.get(id)
    const priorRow = priorDeclarations.get(id)
    const scope = prior !== undefined && priorRow?.parent === row.parent && prior.parent === parent
      ? prior : new NativeScope(parent)
    scopes.set(id, scope)
    return scope
  }
  for (const row of profile.scopes) create(row.id)
  return scopes
}

function scopeAncestry(profile: NativeProfileConfig, scopeId: string): string[] {
  const declarations = new Map(profile.scopes.map(scope => [scope.id, scope]))
  const ancestry: string[] = []
  let current: string | undefined = scopeId
  while (current !== undefined) {
    const scope = declarations.get(current)
    if (scope === undefined) throw new Error(`native profile lost scope ${current}`)
    ancestry.push(scope.id)
    current = scope.parent
  }
  return ancestry
}

/**
 * Derive child routes from the nearest visible pi-ai model Provider and validate child admission.
 * @param profile - selected native composition before child runtime activation.
 * @param selected - active packages and their declared Provider services.
 * @returns the profile with route catalogs copied into enabled child installations.
 */
export function nativeProfileChildProviderRoutes(profile: NativeProfileConfig,
  selected: readonly NativeProfileChildRouteProvider[]): NativeProfileConfig {
  const installations = [...profile.installations]
  for (let index = 0; index < installations.length; index += 1) {
    const child = installations[index]
    if ((child?.plugin !== '@deepseek-ai/dsh-sdk-child' && child?.plugin !== '@deepseek-ai/dsh-acp-child')
      || child.disabled === true) continue
    const config = typeof child.config === 'object' && child.config !== null && !Array.isArray(child.config)
      ? child.config as Record<string, unknown> : {}
    if (child.plugin === '@deepseek-ai/dsh-acp-child'
      && (typeof config.providerName !== 'string' || config.providerName === '')) {
      throw new Error(`native profile installation ${child.id} must select an acp-child providerName`)
    }
    const modelProvider = nearestSelectedProvider(selected, scopeAncestry(profile, child.scope), 'model')
    if (modelProvider === undefined) throw new Error(`native profile installation ${child.id} has no visible model Provider`)
    if (modelProvider.plugin !== '@deepseek-ai/dsh-llm-pi-ai') {
      throw new Error(`native profile installation ${child.id} cannot inherit route config from model Provider ${modelProvider.plugin}`)
    }
    const providerConfig = typeof modelProvider.config === 'object' && modelProvider.config !== null && !Array.isArray(modelProvider.config)
      ? modelProvider.config as Record<string, unknown> : undefined
    const providers = typeof providerConfig?.providers === 'object' && providerConfig.providers !== null && !Array.isArray(providerConfig.providers)
      ? providerConfig.providers : undefined
    if (providers === undefined || Object.keys(providers).length === 0) {
      throw new Error(`native profile installation ${child.id} has no route catalog in its nearest pi-ai Provider`)
    }
    const updated = { ...child, config: { ...config, providers } }
    installations[index] = updated
  }
  return { ...profile, installations }
}

function childProviderRoutes(profile: NativeProfileConfig, selected: SelectedPackage[]): NativeProfileConfig {
  const routed = nativeProfileChildProviderRoutes(profile, selected.map(({ row, entry }) => ({
    id: row.id, plugin: row.plugin, scope: row.scope,
    ...Object.hasOwn(row, 'config') ? { config: row.config } : {},
    provides: entry.provides,
  })))
  for (const item of selected) {
    const row = routed.installations.find(installation => installation.id === item.row.id)
    if (row !== undefined) item.row = row
  }
  return routed
}

function childRuntimeProviders(profile: NativeProfileConfig, selected: SelectedPackage[],
  target: 'host' | 'client', anchors: readonly ReturnType<typeof createRequire>[], roots: readonly string[] | undefined): NativeProfileConfig {
  const additions = nativeProfileChildSupportInstallations(profile,
    selected.map(item => ({ scope: item.row.scope, provides: item.entry.provides })),
    (ancestry, service) => disabledNativeProvider(profile.installations, ancestry, service, anchors)?.plugin)
  if (additions.length === 0) return profile
  const installations = [...profile.installations]
  for (const addition of additions) {
    const row = { id: addition.id, plugin: addition.plugin, scope: addition.scope }
    const selectedPackage = selectNativePackage(row, target, anchors, roots)
    if (!selectedPackage.entry.provides.includes(addition.service)) {
      throw new Error(`native child runtime package ${addition.plugin} does not provide ${addition.service}`)
    }
    installations.push(row)
    selected.push(selectedPackage)
  }
  return { ...profile, installations }
}

function nearestSelectedProvider(
  selected: readonly NativeProfileChildRouteProvider[], ancestry: readonly string[], service: string,
): NativeProfileChildRouteProvider | undefined {
  return ancestry.map(scope => selected.find(item => item.scope === scope && item.provides.includes(service)))
    .find(item => item !== undefined)
}

function disabledNativeProvider(installations: NativeProfileConfig['installations'], ancestry: readonly string[], service: string,
  anchors: readonly ReturnType<typeof createRequire>[]): NativeProfileConfig['installations'][number] | undefined {
  for (const scope of ancestry) {
    for (const row of installations) {
      if (row.scope !== scope || row.disabled !== true) continue
      for (const anchor of anchors) {
        let manifestPath: string
        try { manifestPath = anchor.resolve(`${row.plugin}/package.json`) }
        catch { continue }
        const manifest = jsonFile(manifestPath) as { dsh?: { native?: unknown }; exports?: Record<string, unknown> }
        if (manifest.dsh?.native === undefined) continue
        const entry = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports ?? {})))
        if (entry.provides.includes(service)) return row
      }
    }
  }
  return undefined
}

function selectNativePackage(row: NativeProfileConfig['installations'][number], target: 'host' | 'client',
  anchors: readonly ReturnType<typeof createRequire>[], roots: readonly string[] | undefined): SelectedPackage {
  for (const anchor of anchors) {
    let manifestPath: string | undefined
    try {
      manifestPath = anchor.resolve(`${row.plugin}/package.json`)
      const manifest = jsonFile(manifestPath) as {
        name?: string
        version?: string
        dsh?: { native?: unknown }
        exports?: Record<string, unknown>
      }
      if (typeof manifest.name !== 'string' || manifest.name.length === 0
        || typeof manifest.version !== 'string' || manifest.version.length === 0) {
        throw new Error('package manifest must declare a name and version')
      }
      if (roots !== undefined) {
        const packageDir = realpathSync(join(manifestPath, '..'))
        if (manifest.name !== row.plugin || !roots.some(root => contained(root, packageDir))) {
          throw new Error('package identity differs or package is outside the installed profile/runtime')
        }
      }
      const entry = parseNativeEntryManifest(manifest.dsh?.native, new Set(Object.keys(manifest.exports ?? {})))
      if (!entry.targets.includes(target)) throw new Error(`${row.plugin} does not support ${target}`)
      const entryPath = anchor.resolve(`${row.plugin}${entry.entry.slice(1)}`)
      if (roots !== undefined && !contained(realpathSync(join(manifestPath, '..')), realpathSync(entryPath))) {
        throw new Error('native export escapes its installed package')
      }
      return { row, entry, entryPath, package: { name: manifest.name, version: manifest.version } }
    } catch (error) {
      if (manifestPath !== undefined) throw new Error(`native installation ${row.id}: invalid package ${row.plugin}`, { cause: error })
    }
  }
  throw new Error(`native installation ${row.id}: package ${row.plugin} is not installed`)
}

async function nativeAgentPresetFolders(profile: NativeProfileConfig, home: string,
  anchors: readonly ReturnType<typeof createRequire>[]): Promise<NativeProfileConfig> {
  const presetsInstallation = profile.installations.find(row => row.plugin === '@deepseek-ai/dsh-agent-presets' && row.disabled !== true)
  if (presetsInstallation === undefined) return profile
  const { nativePresetRoots, scanNativePresetFolders } = await import('@deepseek-ai/dsh-agent-presets/native')
  const roots = nativePresetRoots(home)
  const registeredPresetIds = new Set(profile.installations.flatMap((row) => {
    if (row.plugin !== '@deepseek-ai/dsh-agent-preset-standing'
      || typeof row.config !== 'object' || row.config === null || Array.isArray(row.config)) return []
    const id = (row.config as Record<string, unknown>).id
    return typeof id === 'string' ? [id] : []
  }))
  const folders = scanNativePresetFolders(roots).map((folder) => {
    if (folder.status !== 'ready' || registeredPresetIds.has(folder.id)) return folder
    const missing = folder.installations?.find(row => row.disabled !== true && !anchors.some((anchor) => {
      try {
        anchor.resolve(`${row.plugin}/package.json`)
        return true
      } catch {
        return false
      }
    }))
    return missing === undefined ? folder : {
      ...folder, status: 'invalid' as const, problem: `plugin ${missing.plugin} is not installed`,
    }
  })
  const summaries: NativePresetFolderSummary[] = folders.map(({ id, name, description, trust, status, problem }) => ({
    id, name, trust, status,
    ...description === undefined ? {} : { description },
    ...problem === undefined ? {} : { problem },
  }))
  const scopes = [...profile.scopes]
  const scopeIds = new Set(scopes.map(scope => scope.id))
  const installations = [...profile.installations]
  const installationIds = new Set(installations.map(row => row.id))
  for (const folder of folders) {
    if (folder.status !== 'ready' || registeredPresetIds.has(folder.id)) continue
    const scope = `preset:${folder.id}`
    if (scopeIds.has(scope)) {
      throw new Error(`dsh: profile already declares scope ${scope} but does not register preset ${folder.id}`)
    }
    for (const row of folder.installations ?? []) {
      const id = `${scope}/${row.id}`
      if (installationIds.has(id)) {
        throw new Error(`dsh: preset ${folder.id} install id ${id} collides with an existing profile installation`)
      }
      installationIds.add(id)
    }
    if (installationIds.has(scope)) {
      throw new Error(`dsh: preset ${folder.id} install id ${scope} collides with an existing profile installation`)
    }
    installationIds.add(scope)
    scopeIds.add(scope)
    scopes.push({ id: scope, parent: presetsInstallation.scope })
    for (const row of folder.installations ?? []) {
      installations.push({ ...row, id: `${scope}/${row.id}`, scope })
    }
    installations.push({ id: scope, plugin: '@deepseek-ai/dsh-agent-preset-standing', scope,
      config: { id: folder.id, name: folder.name,
        ...folder.description === undefined ? {} : { description: folder.description } } })
  }
  installations[installations.indexOf(presetsInstallation)] = {
    ...presetsInstallation, config: {
      ...(presetsInstallation.config as Record<string, unknown>), folders: summaries, managementRoots: roots,
    },
  }
  return { ...profile, scopes, installations }
}

/**
 * Expand unregistered native preset folders before planning their installations.
 * @param profile - validated native profile composition.
 * @param anchors - package resolvers used to check preset installations.
 * @param home - Harness home containing user presets; defaults to the configured home.
 * @returns the profile with ready preset installations and folder summaries.
 */
export function expandNativeProfilePresets(profile: NativeProfileConfig,
  anchors: readonly ReturnType<typeof createRequire>[], home = resolveDshHome()): Promise<NativeProfileConfig> {
  return nativeAgentPresetFolders(profile, home, anchors)
}
/** Read the same strict composition used by native boot, without importing plugin code. */
export function readNativeProfile(options: {
  profile: string
  patchFiles: readonly string[]
  home?: string
  profileDir?: string
}): NativeProfileConfig {
  const home = options.home ?? resolveDshHome()
  const profileDir = options.profileDir ?? join(home, 'profiles', options.profile)
  const runtime = options.profileDir === undefined ? profileRuntime(options.profile, home) : profileDirectoryRuntime(profileDir)
  if (runtime !== 'native') {
    throw new Error(`dsh: profile ${options.profile} does not select native execution`)
  }
  refuseLegacyPatch(join(profileDir, 'cordis.patch.yml'))
  if (options.profileDir === undefined) refuseLegacyPatch(join(home, 'cordis.patch.yml'))
  refuseLegacyPatch(join(profileDir, 'desktop.cordis.yml'))
  const base = parseNativeProfileConfig(jsonFile(join(profileDir, 'rsh.profile.json')))
  return applyNativeProfilePatches(base, options.patchFiles.map(file => jsonFile(resolve(file))))
}

/**
 * Validate every static package declaration before importing any selected entry.
 * @param options - profile name, ordered JSON overlays, target and application package anchor.
 * @returns an unstarted host, validated profile and request identities.
 */
export async function loadNativeProfile(options: {
  profile: string
  patchFiles: readonly string[]
  target: 'host' | 'client'
  installAnchor: string
  home?: string
  /** Installed or staged directory replacing the home-relative profile lookup. */
  profileDir?: string
  /** Real roots permitted to contain selected packages and exported entries. */
  containedRoots?: readonly string[]
  /** Private carrier contribution installed in the selected profile scope. */
  carrier?: { readonly plugin: NativePlugin; readonly scope: string }
  /** Previous load whose unchanged scope and installation identities should survive a reload. */
  previous?: LoadedNativeProfile
  onApplication?: (application: NativeApplication) => void
}): Promise<LoadedNativeProfile> {
  const home = options.home ?? resolveDshHome()
  const environment = options.target === 'host' ? loadLayeredEnv('dsh') : undefined
  const profileDir = options.profileDir ?? join(home, 'profiles', options.profile)
  let profile = readNativeProfile({
    profile: options.profile, patchFiles: options.patchFiles, home,
    ...(options.profileDir === undefined ? {} : { profileDir }),
  })
  const anchors = [createRequire(options.installAnchor), createRequire(join(profileDir, 'package.json'))]
  profile = await expandNativeProfilePresets(profile, anchors, home)
  const selected: SelectedPackage[] = []
  const roots = options.containedRoots?.map(root => realpathSync(root))
  for (const row of profile.installations) {
    if (row.disabled === true) continue
    selected.push(selectNativePackage(row, options.target, anchors, roots))
  }
  profile = childProviderRoutes(profile, selected)
  profile = childRuntimeProviders(profile, selected, options.target, anchors, roots)
  const previousState = options.previous === undefined ? undefined : loadedProfileStates.get(options.previous)
  const scopes = scopesOf(profile, options.previous)
  const requests = new Map<string, InstallationRequest>()
  for (const { row, entry, entryPath, package: packageProvenance } of selected) {
    const imported = await import(pathToFileURL(entryPath).href) as Record<string, unknown>
    const plugin = validateNativePluginEntry(imported.plugin, entry)
    const scope = scopes.get(row.scope)
    if (scope === undefined) throw new Error(`native installation ${row.id} lost scope ${row.scope}`)
    const prior = options.previous?.requests.get(row.id)
    const request = prior !== undefined && prior.plugin === plugin && prior.scope === scope
      && prior.package?.name === packageProvenance.name && prior.package.version === packageProvenance.version
      && isDeepStrictEqual(prior.config, row.config)
      ? prior : { plugin, scope, config: row.config, package: packageProvenance }
    requests.set(row.id, request)
  }
  const planned = [...requests.values()]
  const auxiliaryRequests = new Map<string, InstallationRequest>()
  if (options.carrier !== undefined) {
    const scope = scopes.get(options.carrier.scope)
    if (scope === undefined) throw new Error('native carrier selects a missing profile scope')
    const prior = previousState?.auxiliaryRequests.get('carrier')
    const request = prior !== undefined && prior.plugin === options.carrier.plugin && prior.scope === scope
      ? prior : { plugin: options.carrier.plugin, scope, config: undefined }
    auxiliaryRequests.set('carrier', request)
    planned.push(request)
  }
  const inventory = previousState?.inventory ?? { host: undefined as NativeHost | undefined }
  const childProviders = nativeProfileChildRuntimeProviders(profile,
    selected.map(item => ({ scope: item.row.scope, provides: item.entry.provides })),
    (ancestry, service) => disabledNativeProvider(profile.installations, ancestry, service, anchors)?.plugin)
  for (const child of childProviders) {
    const scope = scopes.get(child.scope)
    if (scope === undefined) throw new Error(`native profile lost child scope ${child.scope}`)
    const prior = previousState?.auxiliaryRequests.get(child.key)
    const request = prior !== undefined && prior.plugin === child.plugin && prior.scope === scope
      ? prior : { plugin: child.plugin, scope, config: undefined }
    auxiliaryRequests.set(child.key, request)
    planned.push(request)
  }
  if (environment !== undefined) for (const row of profile.scopes) {
    if (row.parent !== undefined) continue
    const scope = scopes.get(row.id)
    if (scope === undefined) throw new Error(`native profile lost scope ${row.id}`)
    const key = `launch-environment:${row.id}`
    const prior = previousState?.auxiliaryRequests.get(key)
    const request = prior !== undefined && prior.scope === scope
      ? prior : { plugin: launchEnvironmentProvider(environment), scope, config: undefined }
    auxiliaryRequests.set(key, request)
    planned.push(request)
  }
  if (options.target === 'host') for (const row of profile.scopes) {
    if (row.parent !== undefined) continue
    const scope = scopes.get(row.id)
    if (scope === undefined) throw new Error(`native profile lost scope ${row.id}`)
    const key = `plugin-inventory:${row.id}`
    const prior = previousState?.auxiliaryRequests.get(key)
    const request = prior !== undefined && prior.scope === scope ? prior : {
      plugin: createNativePluginInventoryProvider(() => inventory.host),
      scope, config: undefined,
    }
    auxiliaryRequests.set(key, request)
    planned.push(request)
  }
  let captureRequest: InstallationRequest | undefined
  if (options.onApplication !== undefined) {
    const applications = planned.filter(request => request.plugin.provides.includes('application'))
    if (applications.length !== 1) throw new Error(`native profile ${options.profile} must select exactly one application`)
    const selected = applications[0]
    if (selected === undefined) throw new Error('native profile lost its application')
    const priorCapture = previousState?.onApplication === options.onApplication ? previousState.captureRequest : undefined
    const capture: NativePlugin = priorCapture?.plugin ?? {
      apiVersion: 1, name: 'dsh-native-launch', targets: ['host'], requires: ['application'], provides: [],
      resolve: () => (context) => { options.onApplication?.(context.require('application')) },
    }
    captureRequest = priorCapture !== undefined && priorCapture.scope === selected.scope
      ? priorCapture : { plugin: capture, scope: selected.scope, config: undefined }
    planned.push(captureRequest)
  }
  const plan = resolveInstallation(planned, options.target)
  const loaded: LoadedNativeProfile = { host: new NativeHost(plan), profile, requests }
  inventory.host ??= loaded.host
  loadedProfileStates.set(loaded, {
    inventory, scopes, captureRequest, onApplication: options.onApplication, auxiliaryRequests, plan,
  })
  return loaded
}

/** Replace the running profile graph and retain the existing Host after candidate activation succeeds.
 * @param host - Started Host whose current graph owns the running application.
 * @param candidate - Validated profile plan returned by {@link loadNativeProfile}.
 * @returns The candidate composition associated with the retained Host.
 */
export async function replaceNativeProfile(host: NativeHost, candidate: LoadedNativeProfile): Promise<LoadedNativeProfile> {
  const state = loadedProfileStates.get(candidate)
  if (state === undefined) throw new Error('native profile candidate was not loaded by this process')
  await host.replace(state.plan)
  state.inventory.host = host
  const loaded: LoadedNativeProfile = { ...candidate, host }
  loadedProfileStates.set(loaded, state)
  return loaded
}

function contained(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}
