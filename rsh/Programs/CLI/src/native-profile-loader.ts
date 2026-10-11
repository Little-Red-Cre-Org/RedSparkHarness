/** Native package discovery and installation planning for a selected dsh profile. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import type { NativePresetFolderSummary } from '@deepseek-ai/dsh-agent-presets/native'
import {
  NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry,
  type InstallationRequest, type NativeApplication, type NativeEntryManifest, type NativePlugin,
} from '@deepseek-ai/dsh-native-runtime'
import { launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { loadLayeredEnv } from '@deepseek-ai/dsh-launch-environment/layers'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  applyNativeProfilePatches, parseNativeProfileConfig, profileDirectoryRuntime, profileRuntime, type NativeProfileConfig,
} from './native-profile-config.ts'

interface SelectedPackage {
  row: NativeProfileConfig['installations'][number]
  entry: NativeEntryManifest
  entryPath: string
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

function sdkChildProviderRoutes(profile: NativeProfileConfig): NativeProfileConfig {
  const childIndex = profile.installations.findIndex(row => row.plugin === '@deepseek-ai/dsh-sdk-child')
  if (childIndex === -1) return profile
  const providerRow = profile.installations.find(row => row.plugin === '@deepseek-ai/dsh-llm-pi-ai')
  const providerConfig = typeof providerRow?.config === 'object' && providerRow.config !== null && !Array.isArray(providerRow.config)
    ? providerRow.config as Record<string, unknown> : undefined
  const providers = typeof providerConfig?.providers === 'object' && providerConfig.providers !== null && !Array.isArray(providerConfig.providers)
    ? providerConfig.providers : {}
  const child = profile.installations[childIndex]
  if (child === undefined) throw new Error('native profile lost the SDK child installation')
  const childConfig = typeof child.config === 'object' && child.config !== null && !Array.isArray(child.config)
    ? child.config as Record<string, unknown> : {}
  const installations = [...profile.installations]
  installations[childIndex] = { ...child, config: { ...childConfig, providers } }
  return { ...profile, installations }
}

async function nativeAgentPresetFolders(profile: NativeProfileConfig, home: string,
  anchors: readonly ReturnType<typeof createRequire>[]): Promise<NativeProfileConfig> {
  const presetsInstallation = profile.installations.find(row => row.plugin === '@deepseek-ai/dsh-agent-presets' && row.disabled !== true)
  if (presetsInstallation === undefined) return profile
  const { nativePresetRoots, scanNativePresetFolders } = await import('@deepseek-ai/dsh-agent-presets/native')
  const registeredPresetIds = new Set(profile.installations.flatMap((row) => {
    if (row.plugin !== '@deepseek-ai/dsh-agent-preset-standing'
      || typeof row.config !== 'object' || row.config === null || Array.isArray(row.config)) return []
    const id = (row.config as Record<string, unknown>).id
    return typeof id === 'string' ? [id] : []
  }))
  const folders = scanNativePresetFolders(nativePresetRoots(home)).map((folder) => {
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
    ...presetsInstallation, config: { ...(presetsInstallation.config as Record<string, unknown>), folders: summaries },
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
  return sdkChildProviderRoutes(applyNativeProfilePatches(base, options.patchFiles.map(file => jsonFile(resolve(file)))))
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
    let manifestPath: string | undefined
    let entryPath: string | undefined
    for (const anchor of anchors) {
      try {
        manifestPath = anchor.resolve(`${row.plugin}/package.json`)
        const manifest = jsonFile(manifestPath) as { name?: string; dsh?: { native?: unknown }; exports?: Record<string, unknown> }
        if (roots !== undefined) {
          const packageDir = realpathSync(join(manifestPath, '..'))
          if (manifest.name !== row.plugin || !roots.some(root => contained(root, packageDir))) {
            throw new Error('package identity differs or package is outside the installed profile/runtime')
          }
        }
        const entry = parseNativeEntryManifest(manifest.dsh?.native, new Set(Object.keys(manifest.exports ?? {})))
        if (!entry.targets.includes(options.target)) {
          throw new Error(`${row.plugin} does not support ${options.target}`)
        }
        entryPath = anchor.resolve(`${row.plugin}${entry.entry.slice(1)}`)
        if (roots !== undefined && !contained(realpathSync(join(manifestPath, '..')), realpathSync(entryPath))) {
          throw new Error('native export escapes its installed package')
        }
        selected.push({ row, entry, entryPath })
        break
      } catch (error) {
        if (manifestPath !== undefined) throw new Error(`native installation ${row.id}: invalid package ${row.plugin}`, { cause: error })
      }
    }
    if (entryPath === undefined) {
      throw new Error(`native installation ${row.id}: package ${row.plugin} is not installed`)
    }
  }
  const previousState = options.previous === undefined ? undefined : loadedProfileStates.get(options.previous)
  const scopes = scopesOf(profile, options.previous)
  const requests = new Map<string, InstallationRequest>()
  for (const { row, entry, entryPath } of selected) {
    const imported = await import(pathToFileURL(entryPath).href) as Record<string, unknown>
    const plugin = validateNativePluginEntry(imported.plugin, entry)
    const scope = scopes.get(row.scope)
    if (scope === undefined) throw new Error(`native installation ${row.id} lost scope ${row.scope}`)
    const prior = options.previous?.requests.get(row.id)
    const request = prior !== undefined && prior.plugin === plugin && prior.scope === scope && isDeepStrictEqual(prior.config, row.config)
      ? prior : { plugin, scope, config: row.config }
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
  const inventory = previousState?.inventory ?? { host: undefined as NativeHost | undefined }
  if (options.target === 'host') for (const row of profile.scopes) {
    if (row.parent !== undefined) continue
    const scope = scopes.get(row.id)
    if (scope === undefined) throw new Error(`native profile lost scope ${row.id}`)
    const key = `plugin-inventory:${row.id}`
    const prior = previousState?.auxiliaryRequests.get(key)
    const request = prior !== undefined && prior.scope === scope ? prior : {
      plugin: {
        apiVersion: 1, name: 'dsh-native-plugin-inventory', targets: ['host'], requires: [], provides: ['pluginInventory'],
        resolve: () => (context) => {
          context.provide('pluginInventory', { list: () => inventory.host?.diagnostics() ?? [] })
        },
      } satisfies NativePlugin,
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
  const loaded: LoadedNativeProfile = { ...candidate, host }
  loadedProfileStates.set(loaded, state)
  return loaded
}

function contained(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}
