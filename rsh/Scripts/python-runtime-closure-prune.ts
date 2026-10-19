/**
 * Prune a deployed Python runtime closure to the packages its shipped profiles actually reach.
 *
 * `pnpm deploy` resolves the CLI package's own optional dependencies, so the staged tree carries
 * the whole legacy Cordis assembly even when the runtime manifest does not ask for it. This module
 * walks the staged tree from the declared closure and removes everything the closure cannot reach.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** One package found in the deployed node_modules tree. */
export interface StagedPackage {
  readonly name: string
  readonly directory: string
  readonly manifest: {
    readonly version?: string
    readonly dependencies?: Record<string, string>
    readonly optionalDependencies?: Record<string, string>
    readonly peerDependencies?: Record<string, string>
    readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>
  }
}

/**
 * Locate every installed package directory under a node_modules tree, including `.pnpm` entries.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @returns packages keyed by installed name.
 */
export function readStagedPackages(nodeModules: string): Map<string, StagedPackage> {
  const packages = new Map<string, StagedPackage>()
  const record = (directory: string, fallbackName: string): void => {
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) return
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as StagedPackage['manifest'] & { name?: unknown }
      const name = typeof manifest.name === 'string' ? manifest.name : fallbackName
      if (!packages.has(name)) packages.set(name, { name, directory, manifest })
    } catch {
      // A malformed manifest cannot be resolved as a dependency; leave it for the caller to report.
    }
  }
  if (!existsSync(nodeModules)) return packages
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(join(nodeModules, entry.name), { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        record(join(nodeModules, entry.name, scoped.name), `${entry.name}/${scoped.name}`)
      }
    } else {
      record(join(nodeModules, entry.name), entry.name)
    }
  }
  return packages
}

/**
 * Packages whose `optionalDependencies` are legacy assembly rather than runtime needs.
 *
 * The CLI declares the Cordis bundles and alternative hosts as optional dependencies so a published
 * install can skip them. A packaged runtime resolves `optionalDependencies` eagerly, which is what
 * drags the legacy assembly into the Python wheel.
 */
export const OPTIONAL_EDGES_EXCLUDED_FOR: readonly string[] = ['@deepseek-ai/dsh']

/**
 * Optional neighbours that are legacy assembly rather than runtime needs.
 *
 * A package may list a plugin in `peerDependenciesMeta` as optional and still import it by value at
 * runtime, which is how `dsh-agent-presets` uses `dsh-scope`. Dropping such a package breaks the
 * packaged runtime, so only the legacy Cordis neighbours stay excluded.
 */
function isLegacyOptionalNeighbour(name: string): boolean {
  return name.startsWith('@deepseek-ai/cordis')
}

/**
 * Compute the packages a staged closure can reach from its declared dependencies.
 *
 * Every neighbour the runtime can resolve counts: `dependencies`, `optionalDependencies` of a
 * non-leaf package, and peers whether or not the manifest marks them optional. Only the legacy
 * Cordis assembly stays out, because that is what this prune exists to remove.
 * @param packages - installed packages keyed by name.
 * @param declared - names the runtime manifest declares.
 * @param leafPackages - names whose optional dependency edges must not be followed.
 * @returns reachable names, and names that were declared but could not be resolved.
 */
export function reachableStagedPackages(
  packages: ReadonlyMap<string, StagedPackage>,
  declared: readonly string[],
  leafPackages: readonly string[] = [],
): { reachable: Set<string>; unresolved: string[] } {
  const leaves = new Set(leafPackages)
  const reachable = new Set<string>()
  const unresolved: string[] = []
  const queue = [...declared]
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (reachable.has(name)) continue
    const staged = packages.get(name)
    if (staged === undefined) {
      unresolved.push(name)
      reachable.add(name)
      continue
    }
    reachable.add(name)
    for (const dependency of Object.keys(staged.manifest.dependencies ?? {})) queue.push(dependency)
    if (!leaves.has(name)) {
      for (const dependency of Object.keys(staged.manifest.optionalDependencies ?? {})) queue.push(dependency)
    }
    // A peer, optional or not, is something the package imports at runtime and resolves from the
    // staging root; the legacy Cordis assembly is the only optional neighbour kept out.
    for (const peer of Object.keys(staged.manifest.peerDependencies ?? {})) {
      const optional = staged.manifest.peerDependenciesMeta?.[peer]?.optional === true
      if (optional && isLegacyOptionalNeighbour(peer)) continue
      queue.push(peer)
    }
  }
  return { reachable, unresolved: unique(unresolved) }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

/** Outcome of one closure prune. */
export interface PruneResult {
  readonly removed: readonly string[]
  readonly unresolved: readonly string[]
  /** `owner -> nested package` entries whose nested tree was kept because it is not equivalent. */
  readonly retainedNested?: readonly string[]
}

/**
 * Remove staged packages the declared closure cannot reach.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @param declared - dependency names the runtime manifest declares.
 * @param leafPackages - packages whose optional dependency edges must not be followed.
 * @param dryRun - report the plan without deleting.
 * @returns removed and unresolved package names, plus nested trees kept for a divergence.
 */
export function pruneStagedClosure(
  nodeModules: string,
  declared: readonly string[],
  leafPackages: readonly string[] = [],
  dryRun = false,
): PruneResult {
  const packages = readStagedPackages(nodeModules)
  const { reachable, unresolved } = reachableStagedPackages(packages, declared, leafPackages)
  const pruned = [...packages.keys()].filter(name => !reachable.has(name))
  if (dryRun) return { removed: pruned.sort(), unresolved }
  for (const name of pruned) {
    const staged = packages.get(name)
    if (staged === undefined) continue
    rmSync(staged.directory, { recursive: true, force: true })
  }
  // The virtual store holds the same trees; removing it after the links are gone drops the copies.
  rmSync(join(nodeModules, '.pnpm'), { recursive: true, force: true })
  // Nested node_modules trees under retained packages are only weight when they duplicate the
  // staging root exactly; a divergent copy is what Node would actually resolve, so it stays.
  const retainedNested = pruneNestedNodeModules(nodeModules, reachable, packages)
  return { removed: pruned.sort(), unresolved, ...(retainedNested.length === 0 ? {} : { retainedNested }) }
}

/**
 * Delete the nested node_modules trees of retained packages that duplicate the staging root.
 *
 * Node resolves `<package>/node_modules/<dep>` before the staging root, so a nested copy decides
 * which module the runtime loads. A tree is removed only when every package it holds, at every
 * depth, is equivalent to its same-named root package: same version, same `dependencies`, and
 * same `peerDependencies`. Anything else stays, and is reported to the caller.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @param reachable - package names the closure keeps.
 * @param rootPackages - packages read from the staging root before any deletion.
 * @returns `owner -> nested package` entries whose divergence kept the nested tree.
 */
function pruneNestedNodeModules(
  nodeModules: string,
  reachable: ReadonlySet<string>,
  rootPackages: ReadonlyMap<string, StagedPackage>,
): string[] {
  const retained: string[] = []
  const visitPackage = (owner: string, directory: string): void => {
    const nested = join(directory, 'node_modules')
    if (!existsSync(nested)) return
    const divergent: string[] = []
    // Judge the complete tree: a copy that nests further is not proven equivalent by its
    // direct children alone, so descend instead of assuming the deeper levels match.
    const inspect = (candidate: string, label: string): void => {
      for (const [name, staged] of readStagedPackages(candidate)) {
        if (!isEquivalentToRoot(staged, rootPackages.get(name))) {
          divergent.push(label === '' ? name : `${label}/${name}`)
          continue
        }
        const deeper = join(staged.directory, 'node_modules')
        if (existsSync(deeper)) inspect(deeper, label === '' ? name : `${label}/${name}`)
      }
    }
    inspect(nested, '')
    if (divergent.length === 0) {
      rmSync(nested, { recursive: true, force: true })
      return
    }
    for (const name of divergent.sort()) retained.push(`${owner} -> ${name}`)
  }
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModules, entry.name)
      if (!existsSync(scopeDir)) continue
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        const name = `${entry.name}/${scoped.name}`
        if (!reachable.has(name)) continue
        visitPackage(name, join(scopeDir, scoped.name))
      }
    } else {
      if (!reachable.has(entry.name)) continue
      visitPackage(entry.name, join(nodeModules, entry.name))
    }
  }
  return retained.sort()
}

/**
 * Report whether a nested package resolves to the same module as the staging root copy.
 * @param nested - package found below a retained package's own `node_modules`.
 * @param root - same-named package in the staging root, when one exists.
 * @returns true when both declare the same version and the same neighbour maps.
 */
function isEquivalentToRoot(nested: StagedPackage, root: StagedPackage | undefined): boolean {
  if (root === undefined) return false
  if (nested.manifest.version !== root.manifest.version) return false
  return sameMap(nested.manifest.dependencies, root.manifest.dependencies)
    && sameMap(nested.manifest.peerDependencies, root.manifest.peerDependencies)
}

/**
 * Compare two dependency maps regardless of key order.
 * @param left - first map.
 * @param right - second map.
 * @returns true when both name the same keys with the same ranges.
 */
function sameMap(left: Record<string, string> | undefined, right: Record<string, string> | undefined): boolean {
  const leftMap = left ?? {}
  const rightMap = right ?? {}
  const leftKeys = Object.keys(leftMap).sort()
  const rightKeys = Object.keys(rightMap).sort()
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key, index) => key === rightKeys[index] && leftMap[key] === rightMap[key])
}

/**
 * Report neighbours of retained packages that the tree no longer holds.
 *
 * Only workspace packages count: platform-specific optional payloads (`@esbuild/*`, `@img/*`,
 * `@vscode/ripgrep-*`) are never installed for every target, and the CLI's own manifest is the
 * legacy superset. A missing workspace neighbour means the packaged runtime fails on import, so the
 * build stops here instead of at launch.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @param excludedDependents - packages whose own edges are the legacy superset.
 * @param scopePrefix - package-name prefix whose neighbours the check covers.
 * @returns `dependent -> neighbour` entries that are absent from the tree.
 */
export function missingStagedNeighbours(
  nodeModules: string,
  excludedDependents: readonly string[] = [],
  scopePrefix = '@deepseek-ai/',
): string[] {
  const packages = readStagedPackages(nodeModules)
  const excluded = new Set(excludedDependents)
  const missing: string[] = []
  for (const [name, staged] of packages) {
    if (excluded.has(name)) continue
    // The check mirrors the closure walk: an optional peer is a runtime import too, so a missing one
    // is a launch failure. Only an optional legacy Cordis neighbour stays exempt, as in the walk.
    const meta = staged.manifest.peerDependenciesMeta ?? {}
    const neighbours = [
      ...Object.keys(staged.manifest.dependencies ?? {}),
      ...Object.keys(staged.manifest.optionalDependencies ?? {}),
      ...Object.keys(staged.manifest.peerDependencies ?? {}).filter(peer => !(
        meta[peer]?.optional === true && isLegacyOptionalNeighbour(peer))),
    ]
    for (const neighbour of neighbours) {
      if (!neighbour.startsWith(scopePrefix)) continue
      if (packages.has(neighbour)) continue
      missing.push(`${name} -> ${neighbour}`)
    }
  }
  return missing.sort()
}

/**
 * Report installed packages whose names match a forbidden pattern.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @param pattern - case-insensitive pattern matched against package names.
 * @returns offending package names.
 */
export function installedMatching(nodeModules: string, pattern: RegExp): string[] {
  const packages = readStagedPackages(nodeModules)
  return [...packages.keys()].filter(name => pattern.test(name)).sort()
}
