/** Shared validation for profile execution markers stored under a DSH home. */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Runtime and reload mode declared by one Harness profile package. */
export interface DshProfileExecution {
  runtime: 'native' | 'legacy'
  reload: 'startup' | 'live'
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

const warnedCordisProfiles = new Set<string>()

/** Cordis profiles still boot. Say so once per directory, and do not rewrite the manifest. */
function warnCordisProfile(profileDir: string): void {
  if (warnedCordisProfiles.has(profileDir)) return
  warnedCordisProfiles.add(profileDir)
  console.warn(`profile ${profileDir} still selects Cordis execution; declare "runtime": "native" with "config": "rsh.profile.json" to leave it; see rsh/Docs/native-config-migration.md`)
}

/**
 * Read the runtime marker from one profile package manifest.
 * @param profileDir - directory containing the profile's package.json.
 * @returns the validated profile runtime and configuration reload mode. An
 *   absent manifest reports `legacy` so the caller that initializes a profile
 *   still runs; that writer records the native marker, so a profile this
 *   release creates resolves native from the next read onwards. A Cordis
 *   `bundles` list, or `runtime: 'legacy'`, also reports legacy and warns once.
 * @throws when the manifest mixes Cordis and native fields, or declares neither a native marker nor a bundle list.
 */
export function resolveRshProfileDirectoryExecution(profileDir: string): DshProfileExecution {
  const manifestPath = join(profileDir, 'package.json')
  // "Not initialized yet", not "legacy": the CLI's own initializer writes the
  // native marker, and a custom-name profile only reaches it through this
  // answer. Returning native here would make the initializer refuse its own
  // creation path.
  if (!existsSync(manifestPath)) return { runtime: 'legacy', reload: 'startup' }
  const manifest = object(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown, 'profile package')
  const dsh = manifest.dsh === undefined ? {} : object(manifest.dsh, 'profile dsh')
  const profile = dsh.profile === undefined ? {} : record(dsh.profile, 'dsh.profile', ['bundles', 'patchReload', 'runtime', 'config', 'configReload'])
  if (profile.runtime === undefined) {
    if (profile.config !== undefined || profile.configReload !== undefined) {
      throw new Error(`profile ${profileDir} must declare "runtime": "native" with "config": "rsh.profile.json"; see rsh/Docs/native-config-migration.md`)
    }
    // Cordis callers such as legacy-sdk still ship this shape. Warn, and keep
    // the path runnable until those callers move.
    if (Array.isArray(profile.bundles)) {
      warnCordisProfile(profileDir)
      return { runtime: 'legacy', reload: 'startup' }
    }
    throw new Error(`profile ${profileDir} must declare "runtime": "native" with "config": "rsh.profile.json"; see rsh/Docs/native-config-migration.md`)
  }
  if (profile.runtime === 'legacy') {
    if (profile.config !== undefined || profile.configReload !== undefined) {
      throw new Error('dsh.profile.runtime legacy cannot declare config or configReload; see rsh/Docs/native-config-migration.md')
    }
    warnCordisProfile(profileDir)
    return { runtime: 'legacy', reload: 'startup' }
  }
  if (profile.runtime !== 'native' || profile.config !== 'rsh.profile.json') {
    throw new Error('dsh.profile.runtime/config must select native and rsh.profile.json')
  }
  if (profile.bundles !== undefined || profile.patchReload !== undefined) {
    throw new Error('native profile cannot declare Cordis bundles or patchReload; see rsh/Docs/native-config-migration.md')
  }
  if (profile.configReload !== undefined && profile.configReload !== 'startup' && profile.configReload !== 'live') {
    throw new Error('dsh.profile.configReload must be startup or live')
  }
  return { runtime: 'native', reload: profile.configReload ?? 'startup' }
}

/**
 * Read one profile's execution marker under the resolved Harness home.
 * @param name - profile directory name.
 * @param home - resolved Harness home.
 * @returns the validated profile runtime and configuration reload mode.
 */
export function resolveRshProfileExecution(name: string, home: string): DshProfileExecution {
  validateRshProfileName(name)
  return resolveRshProfileDirectoryExecution(join(home, 'profiles', name))
}

/** Reject names that can escape or alias the profile directory.
 * @param name - profile directory name.
 */
export function validateRshProfileName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name === 'node_modules' || name.includes('/') || name.includes('\\')) {
    throw new Error(`dsh: invalid profile name ${JSON.stringify(name)}`)
  }
}
