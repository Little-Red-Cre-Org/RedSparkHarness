/**
 * Resolve every package the desktop app ships against the workspace.
 *
 * `core-package-set.ts` names packages as strings, so nothing links them to the
 * manifests that define them: a retired package stays listed until a desktop build
 * fails. This gate fails at review time instead.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORKSPACE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const CORE_PACKAGE_SET = join(ROOT, 'rsh/Programs/Desktop/src/core-package-set.ts')

interface Options {
  readonly root: string
  /** Report-only path for focused local runs. */
  readonly listOnly?: boolean
}

/**
 * Collect every `@redspark/rsh-*` string literal named in the desktop package set.
 * @param source - the TypeScript module text.
 * @returns the package names in source order, without duplicates.
 */
export function corePackageNames(source: string): string[] {
  const found = source.matchAll(/['"](@redspark\/[a-z0-9][a-z0-9._~-]*)['"]/gu)
  return [...new Set([...found].map(match => match[1] as string))]
}

/**
 * Map every workspace manifest name to its directory, so a listed package resolves.
 * @param root - repository root.
 * @returns package name to workspace-relative directory.
 */
export function workspacePackages(root: string): Map<string, string> {
  const packages = new Map<string, string>()
  for (const glob of WORKSPACE_MANIFEST_GLOBS) {
    for (const path of globSync(glob, { cwd: root })) {
      const manifest = JSON.parse(readFileSync(join(root, path), 'utf8')) as { name?: unknown }
      if (typeof manifest.name === 'string') packages.set(manifest.name, path)
    }
  }
  return packages
}

/**
 * @param options - repository root.
 * @returns process exit code; zero when every listed package resolves.
 */
export function check(options: Options): number {
  if (!existsSync(CORE_PACKAGE_SET)) {
    console.error(`core package set missing: ${CORE_PACKAGE_SET}`)
    return 1
  }
  const names = corePackageNames(readFileSync(CORE_PACKAGE_SET, 'utf8'))
  const packages = workspacePackages(options.root)
  const unresolved = names.filter(name => !packages.has(name))
  if (options.listOnly === true) {
    for (const name of names) console.log(`${packages.has(name) ? 'ok  ' : 'MISS'} ${name}`)
    return 0
  }
  if (unresolved.length > 0) {
    console.error('core-package-set names packages that no workspace manifest defines:')
    for (const name of unresolved) console.error(`  ${name}`)
    return 1
  }
  console.log(`core-package-set: ${names.length} package(s) resolve against the workspace`)
  return 0
}

/* v8 ignore next 3 -- direct invocation covered by the gate run */
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  process.exitCode = check({ root: ROOT, listOnly: process.argv.includes('--list') })
}
