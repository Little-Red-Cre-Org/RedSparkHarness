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
  DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES,
  DESKTOP_COMPATIBILITY_HOST_PACKAGE,
  DESKTOP_COMPATIBILITY_HOST_RUNTIME_FILES,
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  parseDesktopCorePackageSet,
  type DesktopPackageAssembly,
  type DesktopCorePackageRecord,
} from '../src/core-package-set.ts'
import { capture } from '../../../Scripts/release/process.ts'
import { tarballFiles } from '../../../Scripts/release/tarball.ts'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const DSH_PACKAGE = '@deepseek-ai/dsh'
const ROOT_PACKAGES = [DSH_PACKAGE, DESKTOP_HOST_PACKAGE] as const
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
  readonly assembly: DesktopPackageAssembly
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
  return selectClosure(available, ROOT_PACKAGES, new Set(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES))
}

function selectClosure(
  available: ReadonlyMap<string, PackedDesktopPackage>, roots: readonly string[], skippedOptional: ReadonlySet<string>,
): PackedDesktopPackage[] {
  const selected = new Map<string, PackedDesktopPackage>()
  // Compatibility-only packages stay out of the Native assembly. A peer names a host-provided
  // package, so that edge is skipped; a hard dependency on one cannot be satisfied and fails here.
  const follow = (owner: string, dependency: string, kind: 'dependency' | 'peer' | 'optional'): void => {
    if (skippedOptional.has(dependency)) {
      if (kind === 'dependency') {
        throw new Error(`desktop package set: ${owner} requires compatibility-only package ${dependency}`)
      }
      return
    }
    if (available.has(dependency)) visit(dependency)
    else if (kind !== 'optional' && dependency.startsWith('@deepseek-ai/')) {
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

/** Keep the reviewed Cordis-only optional edges out of the default Native Desktop closure. */
export function selectDesktopPackageSets(
  available: ReadonlyMap<string, PackedDesktopPackage>,
  assembly: DesktopPackageAssembly = 'native',
): SelectedDesktopPackageSet {
  const dsh = available.get(DSH_PACKAGE)
  if (dsh === undefined) throw new Error(`desktop package set: packed inputs omit ${DSH_PACKAGE}`)
  const host = available.get(DESKTOP_HOST_PACKAGE)
  if (host === undefined) throw new Error(`desktop package set: packed inputs omit ${DESKTOP_HOST_PACKAGE}`)
  const dshOptional = new Set(dependencyNames(dsh.manifest, OPTIONAL_DEPENDENCY_SECTION))
  const hostOptional = new Set(dependencyNames(host.manifest, OPTIONAL_DEPENDENCY_SECTION))
  for (const name of DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES) {
    const owner = name === DESKTOP_COMPATIBILITY_HOST_PACKAGE ? hostOptional : dshOptional
    if (!owner.has(name)) throw new Error(`desktop package set: compatibility optional edge ${name} is no longer declared by its owner`)
  }
  const roots = assembly === 'native' ? ROOT_PACKAGES : [...ROOT_PACKAGES, DESKTOP_COMPATIBILITY_HOST_PACKAGE]
  if (assembly === 'compatibility') {
    const compatibilityHost = available.get(DESKTOP_COMPATIBILITY_HOST_PACKAGE)
    if (compatibilityHost === undefined) {
      throw new Error(`desktop package set: compatibility assembly omits ${DESKTOP_COMPATIBILITY_HOST_PACKAGE}`)
    }
  }
  const skippedOptional = assembly === 'native' ? new Set(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES) : new Set<string>()
  const packages = selectClosure(available, roots, skippedOptional)
  const selectedNames = new Set(packages.map(packed => packed.manifest.name))
  if (assembly === 'native') {
    const included = DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES.find(name => selectedNames.has(name))
    if (included !== undefined) throw new Error(`desktop package set: Native assembly requires compatibility-only package ${included}`)
  }
  return {
    assembly,
    packages,
    ignoredOptionalDependencies: DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
      .filter(name => assembly === 'native' || !selectedNames.has(name)).sort(),
  }
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

/** Require the explicit compatibility Host entry and its private Cordis overlay. */
export function assertDesktopCompatibilityHostPackageFiles(files: readonly string[]): void {
  const available = new Set(files)
  const missing = DESKTOP_COMPATIBILITY_HOST_RUNTIME_FILES
    .map(file => `package/${file}`)
    .filter(file => !available.has(file))
  if (missing.length > 0) {
    throw new Error(`desktop package set: ${DESKTOP_COMPATIBILITY_HOST_PACKAGE} tarball omits required file(s): ${missing.join(', ')}`)
  }
}

/** Prepare a package set from release tarball directories. */
export function prepareDesktopPackageSet(
  inputs: readonly string[], output: string, assembly: DesktopPackageAssembly = 'native',
): void {
  const selected = selectDesktopPackageSets(packedPackages(inputs), assembly)
  const host = selected.packages.find(packed => packed.manifest.name === DESKTOP_HOST_PACKAGE)
  if (host === undefined) throw new Error(`desktop package set: selected closure omits ${DESKTOP_HOST_PACKAGE}`)
  assertDesktopHostPackageFiles(tarballFiles(host.tarball))
  if (selected.assembly === 'compatibility') {
    const compatibilityHost = selected.packages.find(packed => packed.manifest.name === DESKTOP_COMPATIBILITY_HOST_PACKAGE)
    if (compatibilityHost === undefined) throw new Error(`desktop package set: selected closure omits ${DESKTOP_COMPATIBILITY_HOST_PACKAGE}`)
    assertDesktopCompatibilityHostPackageFiles(tarballFiles(compatibilityHost.tarball))
  }
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
  if (values.assembly !== undefined && values.assembly !== 'native' && values.assembly !== 'compatibility') {
    throw new Error('desktop package set: --assembly must be native or compatibility')
  }
  const buildPaths = values.assembly === undefined
    ? resolveDesktopTargetBuildPaths()
    : resolveDesktopTargetBuildPaths({ ...process.env, DSH_DESKTOP_ASSEMBLY: values.assembly })
  const inputs = (values.from ?? [buildPaths.packedDsh, buildPaths.packedVendor, buildPaths.packedLandlock])
    .map(path => resolve(REPOSITORY_ROOT, path))
  const output = values.out === undefined ? buildPaths.packageSet : resolve(REPOSITORY_ROOT, values.out)
  prepareDesktopPackageSet(inputs, output, buildPaths.assembly)
  console.log(`desktop package set: prepared ${output}`)
}

if (import.meta.main) main()
