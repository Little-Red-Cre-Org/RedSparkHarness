/** Signed local npm package set that supplies the Desktop-owned dsh runtime and private Host. */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Descriptor copied beside every Desktop profile's local core tarballs. */
export const DESKTOP_PACKAGE_SET_FILE = 'desktop-packages.json'

/** Profile-relative directory containing immutable core npm tarballs. */
export const DESKTOP_PACKAGES_DIR = 'desktop-packages'

/** Private package installed beside dsh to boot the Desktop Host process. */
export const DESKTOP_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host'

/** Compatibility-only Host installed into profiles that select legacy Cordis bundles. */
export const DESKTOP_COMPATIBILITY_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host-compatibility'

/**
 * Cordis runtime packages the Native assembly ships on purpose.
 *
 * The Cordis *kernel* is a service container, not the legacy Desktop assembly: a Native row can
 * host a Cordis plugin through it (see `@deepseek-ai/dsh-cordis-bridge`) so one plugin ecosystem
 * serves both runtimes. The loader and bundle packages below stay excluded, because they compose
 * applications rather than host one plugin.
 */
export const CORDIS_RUNTIME_PACKAGES = [
  '@deepseek-ai/cordis',
] as const

/** Optional package edges owned only by the legacy Cordis Desktop assembly. */
export const DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES = [
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-acp-app',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-agent-tool-presentation',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-client-ui-agent-preset',
  '@deepseek-ai/dsh-client-ui-cordis',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-cordis-client-runner',
  DESKTOP_COMPATIBILITY_HOST_PACKAGE,
  '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-hooks-claude-code',
  '@deepseek-ai/dsh-hooks-codex',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-jobs-local',
  '@deepseek-ai/dsh-rsh',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-sdk-minimal',
  '@deepseek-ai/dsh-time-context',
  '@deepseek-ai/dsh-tmux-context',
  '@deepseek-ai/dsh-tool-bash-persistent',
  '@deepseek-ai/dsh-tool-cordis',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-present',
  '@deepseek-ai/dsh-tool-pwsh-persistent',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-str-replace-editor',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-webhook',
  '@deepseek-ai/dsh-webhook-github',
  '@deepseek-ai/dsh-user-question-broker',
] as const

/** Desktop resource assembly selected when preparing one release. */
export type DesktopPackageAssembly = 'native' | 'compatibility'

/** Package-relative Desktop Host files required before a profile can boot. */
export const DESKTOP_HOST_RUNTIME_FILES = [
  'lib/index.js',
  'lib/native-host.js',
] as const

/** Compatibility package files required only by a legacy Desktop profile. */
export const DESKTOP_COMPATIBILITY_HOST_RUNTIME_FILES = [
  'lib/index.js',
  'config/desktop.cordis.patch.yml',
] as const

/** One immutable npm tarball in the Desktop core package set. */
export interface DesktopCorePackageRecord {
  readonly name: string
  readonly version: string
  readonly file: string
  readonly bytes: number
  readonly integrity: string
}

/** Complete union of the first-party package closures rooted at dsh and its private Desktop Host. */
export interface DesktopCorePackageSet {
  readonly schemaVersion: 2
  readonly assembly: DesktopPackageAssembly
  readonly packages: readonly DesktopCorePackageRecord[]
  readonly ignoredOptionalDependencies: readonly string[]
}

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u
const FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u
const DSH_PACKAGE = '@deepseek-ai/dsh'
const RELEASE_PACKAGES = [DSH_PACKAGE, DESKTOP_HOST_PACKAGE] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate package-set data read from a release artifact or active profile.
 * @param value - Parsed descriptor JSON.
 * @param expectedReleaseVersion - Required dsh and Desktop Host version when validating one release.
 * @returns The normalized package set in deterministic name order.
 */
export function parseDesktopCorePackageSet(
  value: unknown,
  expectedReleaseVersion?: string,
): DesktopCorePackageSet {
  if (!isRecord(value) || value.schemaVersion !== 2
    || (value.assembly !== 'native' && value.assembly !== 'compatibility') || !Array.isArray(value.packages)
    || !Array.isArray(value.ignoredOptionalDependencies)) {
    throw new Error('desktop package set: invalid descriptor')
  }
  const parsePackages = (entries: unknown[]): DesktopCorePackageRecord[] => entries.map((entry): DesktopCorePackageRecord => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !PACKAGE_NAME_PATTERN.test(entry.name)
      || typeof entry.version !== 'string' || !VERSION_PATTERN.test(entry.version)
      || typeof entry.file !== 'string' || !FILE_PATTERN.test(entry.file)
      || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || typeof entry.integrity !== 'string' || !INTEGRITY_PATTERN.test(entry.integrity)) {
      throw new Error('desktop package set: invalid package record')
    }
    return {
      name: entry.name,
      version: entry.version,
      file: entry.file,
      bytes: entry.bytes,
      integrity: entry.integrity,
    }
  })
  const packages = parsePackages(value.packages)
  const names = new Set(packages.map(entry => entry.name))
  const files = new Set(packages.map(entry => entry.file))
  if (names.size !== packages.length || files.size !== packages.length) {
    throw new Error('desktop package set: duplicate package name or filename')
  }
  const sorted = [...packages].sort((left, right) => left.name.localeCompare(right.name))
  if (JSON.stringify(sorted) !== JSON.stringify(packages)) {
    throw new Error('desktop package set: packages must be sorted by name')
  }
  const ignoredOptionalDependencies = value.ignoredOptionalDependencies
  const compatibilityNames = new Set<string>(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES)
  const packageNames = new Set(packages.map(entry => entry.name))
  const expectedIgnored = value.assembly === 'native'
    ? [...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort()
    : DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES.filter(name => !packageNames.has(name))
      .sort()
  if (ignoredOptionalDependencies.some(name => typeof name !== 'string' || !compatibilityNames.has(name))
    || new Set(ignoredOptionalDependencies).size !== ignoredOptionalDependencies.length
    || JSON.stringify(ignoredOptionalDependencies) !== JSON.stringify(expectedIgnored)) {
    throw new Error('desktop package set: ignored optional dependencies do not match the Desktop compatibility policy')
  }
  if (value.assembly === 'native' && [...packageNames].some(name => compatibilityNames.has(name))) {
    throw new Error('desktop package set: Native assembly contains a compatibility-only package')
  }
  const releasePackages = value.assembly === 'native'
    ? RELEASE_PACKAGES
    : [...RELEASE_PACKAGES, DESKTOP_COMPATIBILITY_HOST_PACKAGE] as const
  for (const name of releasePackages) {
    const entry = packages.find(candidate => candidate.name === name)
    if (entry === undefined) throw new Error(`desktop package set: missing ${name}`)
    if (expectedReleaseVersion !== undefined && entry.version !== expectedReleaseVersion) {
      throw new Error(`desktop package set: ${name}@${entry.version} does not match Desktop ${expectedReleaseVersion}`)
    }
  }
  return { schemaVersion: 2, assembly: value.assembly, packages, ignoredOptionalDependencies }
}

/** Read and structurally validate one profile's core package descriptor. */
export function readDesktopCorePackageSet(projectDir: string, expectedReleaseVersion?: string): DesktopCorePackageSet {
  const path = join(projectDir, DESKTOP_PACKAGE_SET_FILE)
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`desktop package set: failed to read ${path}: ${String(error)}`)
  }
  return parseDesktopCorePackageSet(value, expectedReleaseVersion)
}

/** Return the project-relative `file:` spec for one local core tarball. */
export function desktopCorePackageSpec(record: DesktopCorePackageRecord): string {
  return `file:./${DESKTOP_PACKAGES_DIR}/${record.file}`
}

/** Return the exact pnpm override map that keeps every core package off registries. */
export function desktopCorePackageOverrides(packageSet: DesktopCorePackageSet): Record<string, string> {
  return Object.fromEntries(packageSet.packages.map(record => [record.name, desktopCorePackageSpec(record)]))
}

/** Return the local direct dependency spec for the dsh package. */
export function desktopDshPackageSpec(packageSet: DesktopCorePackageSet): string {
  const record = packageSet.packages.find(entry => entry.name === DSH_PACKAGE)
  if (record === undefined) throw new Error(`desktop package set: missing ${DSH_PACKAGE}`)
  return desktopCorePackageSpec(record)
}

/**
 * Verify every local tarball and reject extra package files before pnpm executes them.
 * @param projectDir - Build directory containing the package set.
 * @param expectedReleaseVersion - Exact dsh and Desktop Host version bound to Electron.
 * @returns The verified package set.
 */
export function verifyDesktopCorePackageSet(
  projectDir: string,
  expectedReleaseVersion: string,
): DesktopCorePackageSet {
  const packageSet = readDesktopCorePackageSet(projectDir, expectedReleaseVersion)
  const packageDir = join(projectDir, DESKTOP_PACKAGES_DIR)
  const expectedFiles = packageSet.packages.map(entry => entry.file).sort()
  let actualFiles: string[]
  try {
    actualFiles = readdirSync(packageDir).sort()
  } catch (error) {
    throw new Error(`desktop package set: failed to read ${packageDir}: ${String(error)}`)
  }
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('desktop package set: package directory does not match its descriptor')
  }
  for (const record of packageSet.packages) {
    const path = join(packageDir, record.file)
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`desktop package set: ${record.file} is not a regular file`)
    }
    const body = readFileSync(path)
    const integrity = `sha512-${createHash('sha512').update(body).digest('base64')}`
    if (body.byteLength !== record.bytes || integrity !== record.integrity) {
      throw new Error(`desktop package set: integrity check failed for ${record.file}`)
    }
  }
  return packageSet
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Reject a lockfile that resolved any packaged core name through a registry version.
 * @param lockfile - Generated pnpm lockfile text.
 * @param packageSet - Verified local core package set.
 */
export function verifyDesktopCoreLockfile(
  lockfile: string,
  packageSet: DesktopCorePackageSet,
): void {
  for (const record of packageSet.packages) {
    const registryResolution = new RegExp(
      `^  ['"]?${escapeRegExp(record.name)}@${escapeRegExp(record.version)}(?:\\([^\\r\\n]*\\))?['"]?:`,
      'mu',
    )
    if (registryResolution.test(lockfile)) {
      throw new Error(`desktop package set: lockfile resolved ${record.name}@${record.version} outside the local package set`)
    }
  }
  for (const name of packageSet.ignoredOptionalDependencies) {
    const resolution = new RegExp(`^  ['"]?${escapeRegExp(name)}@[^\\r\\n'"]+['"]?:`, 'mu')
    if (resolution.test(lockfile)) throw new Error(`desktop package set: lockfile resolved ignored compatibility optional ${name}`)
  }
}
