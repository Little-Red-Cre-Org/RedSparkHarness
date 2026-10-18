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
}

/**
 * Remove staged packages the declared closure cannot reach.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @param declared - dependency names the runtime manifest declares.
 * @param leafPackages - packages whose optional dependency edges must not be followed.
 * @param dryRun - report the plan without deleting.
 * @returns removed and unresolved package names.
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
  // Nested node_modules trees under retained packages carry the same superset; a retained package
  // resolves its peers from the staging root, so the nested copies only add unreachable weight.
  // This runs even when nothing was pruned at the top level.
  pruneNestedNodeModules(nodeModules, reachable)
  return { removed: pruned.sort(), unresolved }
}

/**
 * Delete nested node_modules trees under every retained package.
 *
 * A retained package resolves its peers from the staging root, so a nested copy can only add
 * unreachable weight or a second instance of a shared package.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @param reachable - package names the closure keeps.
 */
function pruneNestedNodeModules(nodeModules: string, reachable: ReadonlySet<string>): void {
  const visitPackage = (directory: string): void => {
    const nested = join(directory, 'node_modules')
    if (existsSync(nested)) rmSync(nested, { recursive: true, force: true })
  }
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModules, entry.name)
      if (!existsSync(scopeDir)) continue
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        if (!reachable.has(`${entry.name}/${scoped.name}`)) continue
        visitPackage(join(scopeDir, scoped.name))
      }
    } else {
      if (!reachable.has(entry.name)) continue
      visitPackage(join(nodeModules, entry.name))
    }
  }
}

/**
 * Report required neighbours of retained packages that the tree no longer holds.
 *
 * Only workspace packages count: platform-specific optional payloads (`@esbuild/*`, `@img/*`,
 * `@vscode/ripgrep-*`) are never installed for every target, and the CLI's own manifest is the
 * legacy superset. A missing workspace neighbour means the packaged runtime fails on import, so the
 * build stops here instead of at launch.
 * @param nodeModules - absolute path of the deployed node_modules directory.
 * @param excludedDependents - packages whose own edges are the legacy superset.
 * @returns `dependent -> neighbour` entries that are absent from the tree.
 */
export function missingStagedNeighbours(nodeModules: string, excludedDependents: readonly string[] = []): string[] {
  const packages = readStagedPackages(nodeModules)
  const excluded = new Set(excludedDependents)
  const missing: string[] = []
  for (const [name, staged] of packages) {
    if (excluded.has(name)) continue
    const meta = staged.manifest.peerDependenciesMeta ?? {}
    const neighbours = [
      ...Object.keys(staged.manifest.dependencies ?? {}),
      ...Object.keys(staged.manifest.optionalDependencies ?? {}),
      ...Object.keys(staged.manifest.peerDependencies ?? {}).filter(peer => meta[peer]?.optional !== true),
    ]
    for (const neighbour of neighbours) {
      if (!neighbour.startsWith('@deepseek-ai/')) continue
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
