/** Select and copy the local npm tarball closures that supply Desktop dsh and its private Host. */

import { createHash } from 'node:crypto'
import {
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  parseDesktopCorePackageSet,
  type DesktopCorePackageRecord,
} from '../src/core-package-set.ts'
import { capture } from '../../../Scripts/release/process.ts'
import { tarballFiles } from '../../../Scripts/release/tarball.ts'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const RSH_PACKAGE = '@redspark/rsh'
const ROOT_PACKAGES = [RSH_PACKAGE, DESKTOP_HOST_PACKAGE] as const
const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..', '..')

const OPTIONAL_DEPENDENCY_SECTION = 'optionalDependencies'

/** Packed package information needed to form the local Desktop closure. */
export interface PackedDesktopPackage {
  readonly tarball: string
  readonly manifest: Readonly<Record<string, unknown>>
}

/** Package records split by whether the default Desktop runtime may install them. */
export interface SelectedDesktopPackageSet {
  readonly assembly: 'native'
  readonly packages: readonly PackedDesktopPackage[]
  readonly ignoredOptionalDependencies: readonly string[]
}

function dependencyNames(manifest: Readonly<Record<string, unknown>>, section: string): string[] {
  const value = manifest[section]
  if (value === undefined) return []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`desktop package set: ${String(manifest.name)} has invalid ${section}`)
  }
  return Object.keys(value).sort()
}

function optionalPeerNames(manifest: Readonly<Record<string, unknown>>): Set<string> {
  const metadata = manifest.peerDependenciesMeta
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return new Set()
  const names = Object.entries(metadata).filter(([, peer]) => {
    return peer !== null && typeof peer === 'object' && !Array.isArray(peer)
      && (peer as Record<string, unknown>).optional === true
  }).map(([name]) => name)
  return new Set(names)
}

/**
 * Select the complete available first-party dependency closures rooted at dsh and its private Host.
 * @param available - Packed packages indexed by package name.
 * @returns Selected packages sorted by name.
 */
export function selectDesktopPackageClosure(
  available: ReadonlyMap<string, PackedDesktopPackage>,
): PackedDesktopPackage[] {
  return selectClosure(available, ROOT_PACKAGES)
}

function selectClosure(
  available: ReadonlyMap<string, PackedDesktopPackage>, roots: readonly string[],
): PackedDesktopPackage[] {
  const selected = new Map<string, PackedDesktopPackage>()
  const follow = (owner: string, dependency: string, kind: 'dependency' | 'peer' | 'optional'): void => {
    if (available.has(dependency)) visit(dependency)
    else if (kind !== 'optional' && dependency.startsWith('@redspark/')) {
      throw new Error(`desktop package set: ${owner} requires unpacked internal package ${dependency}`)
    }
  }
  const visit = (name: string): void => {
    if (selected.has(name)) return
    const packed = available.get(name)
    if (packed === undefined) throw new Error(`desktop package set: packed inputs omit required package ${name}`)
    selected.set(name, packed)
    const optionalPeers = optionalPeerNames(packed.manifest)
    for (const dependency of dependencyNames(packed.manifest, 'dependencies')) follow(name, dependency, 'dependency')
    for (const dependency of dependencyNames(packed.manifest, 'peerDependencies')) {
      if (!optionalPeers.has(dependency)) follow(name, dependency, 'peer')
    }
    for (const dependency of dependencyNames(packed.manifest, OPTIONAL_DEPENDENCY_SECTION)) {
      follow(name, dependency, 'optional')
    }
  }
  for (const name of roots) {
    if (!available.has(name)) throw new Error(`desktop package set: packed inputs omit ${name}`)
    visit(name)
  }
  return [...selected.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, packed]) => packed)
}

export function selectDesktopPackageSets(
  available: ReadonlyMap<string, PackedDesktopPackage>,
): SelectedDesktopPackageSet {
  if (!available.has(RSH_PACKAGE)) throw new Error(`desktop package set: packed inputs omit ${RSH_PACKAGE}`)
  if (!available.has(DESKTOP_HOST_PACKAGE)) throw new Error(`desktop package set: packed inputs omit ${DESKTOP_HOST_PACKAGE}`)
  return { assembly: 'native', packages: selectClosure(available, ROOT_PACKAGES), ignoredOptionalDependencies: [] }
}

function packedManifest(tarball: string): Record<string, unknown> {
  const value: unknown = JSON.parse(capture('tar', ['-xOzf', tarball, 'package/package.json']))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`desktop package set: ${tarball} has no package manifest`)
  }
  return value as Record<string, unknown>
}

function packedPackages(inputs: readonly string[]): Map<string, PackedDesktopPackage> {
  const available = new Map<string, PackedDesktopPackage>()
  for (const input of inputs) {
    const tarballs = readdirSync(input).filter(file => file.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`desktop package set: ${input} contains no tarballs`)
    for (const file of tarballs) {
      const tarball = join(input, file)
      const manifest = packedManifest(tarball)
      const name = manifest.name
      if (typeof name !== 'string' || name === '') throw new Error(`desktop package set: ${tarball} has no package name`)
      if (available.has(name)) throw new Error(`desktop package set: duplicate packed package ${name}`)
      available.set(name, { tarball, manifest })
    }
  }
  return available
}

/**
 * Require every private Host file used before the Desktop profile can pass its health check.
 * @param files - Tarball paths rooted at `package/`.
 * @returns Nothing.
 */
export function assertDesktopHostPackageFiles(files: readonly string[]): void {
  const available = new Set(files)
  const missing = DESKTOP_HOST_RUNTIME_FILES
    .map(file => `package/${file}`)
    .filter(file => !available.has(file))
  if (missing.length > 0) {
    throw new Error(`desktop package set: ${DESKTOP_HOST_PACKAGE} tarball omits required file(s): ${missing.join(', ')}`)
  }
}

/** Prepare a package set from release tarball directories. */
export function prepareDesktopPackageSet(
  inputs: readonly string[], output: string,
): void {
  const selected = selectDesktopPackageSets(packedPackages(inputs))
  const host = selected.packages.find(packed => packed.manifest.name === DESKTOP_HOST_PACKAGE)
  if (host === undefined) throw new Error(`desktop package set: selected closure omits ${DESKTOP_HOST_PACKAGE}`)
  assertDesktopHostPackageFiles(tarballFiles(host.tarball))
  rmSync(output, { recursive: true, force: true })
  const packageDir = join(output, DESKTOP_PACKAGES_DIR)
  mkdirSync(packageDir, { recursive: true })
  const copyRecords = (packages: readonly PackedDesktopPackage[]): DesktopCorePackageRecord[] => packages.map((packed) => {
    const name = packed.manifest.name
    const version = packed.manifest.version
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error(`desktop package set: ${packed.tarball} has no package identity`)
    }
    const file = basename(packed.tarball)
    const destination = join(packageDir, file)
    copyFileSync(packed.tarball, destination, constants.COPYFILE_EXCL)
    const body = readFileSync(destination)
    return {
      name,
      version,
      file,
      bytes: statSync(destination).size,
      integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
    }
  })
  const records = copyRecords(selected.packages)
  const packageSet = parseDesktopCorePackageSet({
    schemaVersion: 2, assembly: selected.assembly, packages: records,
    ignoredOptionalDependencies: selected.ignoredOptionalDependencies,
  })
  writeFileSync(join(output, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify(packageSet, undefined, 2)}\n`, { mode: 0o600 })
}

function main(): void {
  const { values } = parseArgs({
    options: { from: { type: 'string', multiple: true }, out: { type: 'string' }, assembly: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.assembly !== undefined && values.assembly !== 'native') {
    throw new Error(`desktop package set: the ${JSON.stringify(values.assembly)} assembly is retired; Desktop ships only the Native assembly (see rsh/Docs/native-config-migration.md)`)
  }
  const buildPaths = resolveDesktopTargetBuildPaths()
  const inputs = (values.from ?? [buildPaths.packedDsh, buildPaths.packedVendor, buildPaths.packedLandlock])
    .map(path => resolve(REPOSITORY_ROOT, path))
  const output = values.out === undefined ? buildPaths.packageSet : resolve(REPOSITORY_ROOT, values.out)
  prepareDesktopPackageSet(inputs, output)
  console.log(`desktop package set: prepared ${output}`)
}

if (import.meta.main) main()
