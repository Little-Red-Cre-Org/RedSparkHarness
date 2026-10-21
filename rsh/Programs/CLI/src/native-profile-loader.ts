/** Native package discovery and installation planning for a selected dsh profile. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
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
  const profile = readNativeProfile({
    profile: options.profile, patchFiles: options.patchFiles, home,
    ...(options.profileDir === undefined ? {} : { profileDir }),
  })
  const anchors = [createRequire(options.installAnchor), createRequire(join(profileDir, 'package.json'))]
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
  loadedProfileStates.set(loaded, {
    scopes, captureRequest, onApplication: options.onApplication, auxiliaryRequests, plan,
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
