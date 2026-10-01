/** Strict JSON profile and overlay validation before native plugin discovery. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Scope identity and optional parent in a native profile. */
export interface NativeProfileScope {
  readonly id: string
  readonly parent?: string
}

/** One explicitly selected native plugin installation. */
export interface NativeProfileInstallation {
  readonly id: string
  readonly plugin: string
  readonly scope: string
  readonly config?: unknown
  readonly disabled?: boolean
}

/** Native composition file, independent of Cordis bundle patches. */
export interface NativeProfileConfig {
  readonly formatVersion: 1
  readonly scopes: readonly NativeProfileScope[]
  readonly installations: readonly NativeProfileInstallation[]
}

/** One JSON overlay row; a present config replaces the complete prior value. */
export interface NativeProfilePatch {
  readonly id: string
  readonly config?: unknown
  readonly disabled?: boolean
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function record(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  const fields = object(value, label)
  for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`${label} has unknown field ${key}`)
  return fields
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a nonempty string`)
  return value
}

function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value as unknown[]
}

function unique(values: readonly { id: string }[], label: string): void {
  if (new Set(values.map(value => value.id)).size !== values.length) throw new Error(`${label} repeats an id`)
}

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/**
 * Parse a versioned native composition and reject unresolved scope references.
 * @param value - JSON-decoded rsh.profile.json content.
 * @returns copied, validated scope and installation rows.
 */
export function parseNativeProfileConfig(value: unknown): NativeProfileConfig {
  const input = record(value, 'native profile', ['formatVersion', 'scopes', 'installations'])
  if (input.formatVersion !== 1) throw new Error('native profile has unsupported formatVersion')
  const scopes = rows(input.scopes, 'native profile scopes').map((value): NativeProfileScope => {
    const scope = record(value, 'native scope', ['id', 'parent'])
    const id = nonempty(scope.id, 'native scope id')
    return scope.parent === undefined ? { id } : { id, parent: nonempty(scope.parent, `native scope ${id} parent`) }
  })
  unique(scopes, 'native scopes')
  const byId = new Map(scopes.map(scope => [scope.id, scope]))
  for (const scope of scopes) {
    const visited = new Set<string>()
    let current: NativeProfileScope | undefined = scope
    while (current !== undefined) {
      if (visited.has(current.id)) throw new Error(`native scope cycle at ${scope.id}`)
      visited.add(current.id)
      if (current.parent !== undefined && !byId.has(current.parent)) {
        throw new Error(`native scope ${current.id} has missing parent ${current.parent}`)
      }
      current = current.parent === undefined ? undefined : byId.get(current.parent)
    }
  }
  const installations = rows(input.installations, 'native profile installations').map((value): NativeProfileInstallation => {
    const row = record(value, 'native installation', ['id', 'plugin', 'scope', 'config', 'disabled'])
    const id = nonempty(row.id, 'native installation id')
    const plugin = nonempty(row.plugin, `native installation ${id} plugin`)
    if (!packageName.test(plugin)) throw new Error(`native installation ${id} plugin must be a package name`)
    const scope = nonempty(row.scope, `native installation ${id} scope`)
    if (!byId.has(scope)) throw new Error(`native installation ${id} has missing scope ${scope}`)
    if (row.disabled !== undefined && typeof row.disabled !== 'boolean') {
      throw new Error(`native installation ${id} disabled must be boolean`)
    }
    return {
      id, plugin, scope,
      ...Object.hasOwn(row, 'config') ? { config: row.config } : {},
      ...row.disabled === undefined ? {} : { disabled: row.disabled },
    }
  })
  unique(installations, 'native installations')
  return { formatVersion: 1, scopes, installations }
}

/**
 * Apply JSON patch rows in order without mutating the profile or prior overlays.
 * @param profile - validated base composition.
 * @param values - JSON-decoded overlays in CLI argument order.
 * @returns validated composition with complete config replacements.
 */
export function applyNativeProfilePatches(profile: NativeProfileConfig, values: readonly unknown[]): NativeProfileConfig {
  const installations = [...profile.installations]
  for (const value of values) {
    const patch = record(value, 'native patch', ['formatVersion', 'installations'])
    if (patch.formatVersion !== 1) throw new Error('native patch has unsupported formatVersion')
    const changes = rows(patch.installations, 'native patch installations').map((value): NativeProfilePatch => {
      const row = record(value, 'native patch row', ['id', 'config', 'disabled'])
      const id = nonempty(row.id, 'native patch id')
      if (!Object.hasOwn(row, 'config') && !Object.hasOwn(row, 'disabled')) {
        throw new Error(`native patch ${id} changes no fields`)
      }
      if (row.disabled !== undefined && typeof row.disabled !== 'boolean') {
        throw new Error(`native patch ${id} disabled must be boolean`)
      }
      return { id, ...Object.hasOwn(row, 'config') ? { config: row.config } : {},
        ...row.disabled === undefined ? {} : { disabled: row.disabled } }
    })
    unique(changes, 'native patch installations')
    for (const change of changes) {
      const index = installations.findIndex(row => row.id === change.id)
      if (index === -1) throw new Error(`native patch targets unknown installation ${change.id}`)
      const prior = installations[index]
      if (prior === undefined) throw new Error(`native patch lost installation ${change.id}`)
      installations[index] = { ...prior, ...change }
    }
  }
  return { ...profile, installations }
}

/**
 * Detect the explicit native profile marker before importing the Cordis boot path.
 * @param name - profile name under the Harness home.
 * @param home - Harness home; the launcher uses the environment-resolved default.
 * @returns native only for a valid explicit marker; missing profiles retain legacy initialization.
 */
export function profileRuntime(name: string, home: string = resolveDshHome()): 'native' | 'legacy' {
  return profileExecution(name, home).runtime
}

/**
 * Resolve a native profile's configuration lifetime before application launch.
 * @param name - explicitly selected native profile name.
 * @param home - Harness home containing its manifest.
 * @returns live only when configReload explicitly selects it; otherwise startup.
 */
export function nativeProfileReloadMode(name: string, home: string = resolveDshHome()): 'live' | 'startup' {
  const execution = profileExecution(name, home)
  if (execution.runtime !== 'native') throw new Error(`dsh: profile ${name} does not select native execution`)
  return execution.reload
}

function profileExecution(name: string, home: string): { runtime: 'native' | 'legacy'; reload: 'startup' | 'live' } {
  validateProfileName(name)
  const manifestPath = join(home, 'profiles', name, 'package.json')
  if (!existsSync(manifestPath)) return { runtime: 'legacy', reload: 'startup' }
  const manifest = object(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown, 'profile package')
  const dsh = manifest.dsh === undefined ? {} : object(manifest.dsh, 'profile dsh')
  const profile = dsh.profile === undefined ? {} : record(dsh.profile, 'dsh.profile', ['bundles', 'patchReload', 'runtime', 'config', 'configReload'])
  if (profile.runtime === undefined) {
    if (profile.config !== undefined || profile.configReload !== undefined) throw new Error('dsh.profile.config/configReload requires runtime native')
    return { runtime: 'legacy', reload: 'startup' }
  }
  if (profile.runtime !== 'native' || profile.config !== 'rsh.profile.json') {
    throw new Error('dsh.profile.runtime/config must select native and rsh.profile.json')
  }
  if (profile.bundles !== undefined || profile.patchReload !== undefined) {
    throw new Error('native profile cannot declare Cordis bundles or patchReload')
  }
  if (profile.configReload !== undefined && profile.configReload !== 'startup' && profile.configReload !== 'live') {
    throw new Error('dsh.profile.configReload must be startup or live')
  }
  return { runtime: 'native', reload: profile.configReload ?? 'startup' }
}

/** Reject names that can escape or alias the profile directory. */
export function validateProfileName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name === 'node_modules' || name.includes('/') || name.includes('\\')) {
    throw new Error(`dsh: invalid profile name ${JSON.stringify(name)}`)
  }
}
