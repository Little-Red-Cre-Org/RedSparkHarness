/** Native package discovery and installation planning for a selected dsh profile. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
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

function scopesOf(profile: NativeProfileConfig): Map<string, NativeScope> {
  const declarations = new Map(profile.scopes.map(scope => [scope.id, scope]))
  const scopes = new Map<string, NativeScope>()
  const create = (id: string): NativeScope => {
    const existing = scopes.get(id)
    if (existing !== undefined) return existing
    const row = declarations.get(id)
    if (row === undefined) throw new Error(`native profile lost scope ${id}`)
    const scope = new NativeScope(row.parent === undefined ? undefined : create(row.parent))
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
  const scopes = scopesOf(profile)
  const requests = new Map<string, InstallationRequest>()
  for (const { row, entry, entryPath } of selected) {
    const imported = await import(pathToFileURL(entryPath).href) as Record<string, unknown>
    const plugin = validateNativePluginEntry(imported.plugin, entry)
    const scope = scopes.get(row.scope)
    if (scope === undefined) throw new Error(`native installation ${row.id} lost scope ${row.scope}`)
    requests.set(row.id, { plugin, scope, config: row.config })
  }
  const planned = [...requests.values()]
  if (options.carrier !== undefined) {
    const scope = scopes.get(options.carrier.scope)
    if (scope === undefined) throw new Error('native carrier selects a missing profile scope')
    planned.push({ plugin: options.carrier.plugin, scope, config: undefined })
  }
  if (environment !== undefined) for (const row of profile.scopes) {
    if (row.parent !== undefined) continue
    const scope = scopes.get(row.id)
    if (scope === undefined) throw new Error(`native profile lost scope ${row.id}`)
    planned.push({ plugin: launchEnvironmentProvider(environment), scope, config: undefined })
  }
  if (options.onApplication !== undefined) {
    const applications = planned.filter(request => request.plugin.provides.includes('application'))
    if (applications.length !== 1) throw new Error(`native profile ${options.profile} must select exactly one application`)
    const selected = applications[0]
    if (selected === undefined) throw new Error('native profile lost its application')
    const capture: NativePlugin = {
      apiVersion: 1, name: 'dsh-native-launch', targets: ['host'], requires: ['application'], provides: [],
      resolve: () => (context) => { options.onApplication?.(context.require('application')) },
    }
    planned.push({ plugin: capture, scope: selected.scope, config: undefined })
  }
  return { host: new NativeHost(resolveInstallation(planned, options.target)), profile, requests }
}

function contained(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}
