/**
 * Verify that every Client installation row in the shipped native-web composition
 * names a package that can actually be loaded as a Native Client.
 *
 * The Desktop packaging path creates that composition, boots a Host against it and
 * only then validates each row's `package.json.dsh.native`. A row naming a package
 * that declares no native entry therefore fails minutes into packaging with
 * `native-runtime: native manifest must be an object`, one row at a time. This gate
 * applies the same validation statically, before any build, and reports every
 * failing row at once.
 *
 * Four independent facts are required for a row to be loadable:
 *   1. `dsh.native` is an object (not absent, not a string, not an array);
 *   2. `dsh.native.targets` includes `client`;
 *   3. `exports` publishes a `./native` subpath;
 *   4. `dsh.native.entry` names a file that exists and exports `plugin` by name.
 *
 * Check 4 exists because a package can pass checks 1-3 and still point `entry` at a
 * file that was never created, or at a file that exports a differently named value.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { shippedNativeProfileClientComposition } from '../Programs/CLI/src/native-profile-template.ts'

const GATE = 'verify-native-client-entries'
const root = resolve(import.meta.dirname, '..', '..')

/** One reason a composition row cannot be loaded as a Native Client. */
interface RowDefect {
  readonly id: string
  readonly plugin: string
  readonly defect: string
}

/** Minimal shape of the fields this gate reads from a package manifest. */
interface ManifestShape {
  readonly name?: unknown
  readonly exports?: unknown
  readonly dsh?: { readonly native?: unknown }
}

/**
 * Index every workspace package by its manifest `name`.
 *
 * Directory names do not follow package names (`dsh-client-native-application`
 * lives in `native-application/`), so the manifest is the only authority.
 */
function workspacePackagesByName(): Map<string, string> {
  const index = new Map<string, string>()
  for (const directory of candidatePackageDirectories()) {
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    let manifest: ManifestShape
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestShape
    } catch {
      continue
    }
    if (typeof manifest.name === 'string' && manifest.name !== '') {
      // First writer wins; a name must be unique inside a pnpm workspace.
      if (!index.has(manifest.name)) index.set(manifest.name, directory)
    }
  }
  return index
}

/** Every directory a workspace package may occupy, per pnpm-workspace.yaml. */
function candidatePackageDirectories(): string[] {
  const workspaceFile = join(root, 'pnpm-workspace.yaml')
  if (!existsSync(workspaceFile)) return []

  const directories: string[] = []
  const seen = new Set<string>()
  const add = (directory: string): void => {
    if (!seen.has(directory) && existsSync(directory)) {
      seen.add(directory)
      directories.push(directory)
    }
  }

  // Only the `packages:` list holds workspace globs. The same file carries other
  // top-level sections (dependency overrides such as `@scope/pkg@1.2.3`) whose
  // entries look identical but are package specs, not directories.
  let inPackages = false
  for (const line of readFileSync(workspaceFile, 'utf8').split(/\r?\n/u)) {
    if (/^[A-Za-z]/u.test(line)) {
      inPackages = /^packages\s*:/u.test(line)
      continue
    }
    if (!inPackages) continue
    // Entries may be bare (`- rsh/Programs/Desktop`) or quoted; strip either form.
    const match = /^\s*-\s*(?:'([^']+)'|"([^"]+)"|([^\s#][^#]*?))\s*$/u.exec(line)
    const pattern = match?.[1] ?? match?.[2] ?? match?.[3]
    if (pattern === undefined || pattern === '' || pattern.startsWith('#')) continue

    const wildcard = pattern.lastIndexOf('*')
    if (wildcard === -1) {
      // A literal entry such as `rsh/Programs/Desktop` is the package itself.
      add(resolve(root, pattern))
      continue
    }
    // A pattern such as `rsh/Programs/Web/client/*` names one parent whose direct
    // children are packages; `rsh/Engine/*/*` names a two-level fan-out.
    const parentRelative = pattern.slice(0, wildcard).replace(/\/$/u, '')
    const trailingWildcards = (pattern.slice(wildcard).match(/\*/gu) ?? []).length
    const parent = resolve(root, parentRelative)
    if (!existsSync(parent)) continue
    add(parent)
    for (const child of readdirSync(parent, { withFileTypes: true })) {
      if (!child.isDirectory()) continue
      const childPath = join(parent, child.name)
      add(childPath)
      if (trailingWildcards > 1) {
        for (const grandchild of readdirSync(childPath, { withFileTypes: true })) {
          if (grandchild.isDirectory()) add(join(childPath, grandchild.name))
        }
      }
    }
  }
  return directories
}

/** Read one package manifest, or undefined when it is unreadable or invalid JSON. */
function readManifest(directory: string): ManifestShape | undefined {
  try {
    return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as ManifestShape
  } catch {
    return undefined
  }
}

/** True when a source file exports `plugin` as a named binding. */
function exportsNamedPlugin(file: string): boolean {
  const source = readFileSync(file, 'utf8')
  // `export const plugin`, `export { plugin }`, and `export { x as plugin }` all
  // satisfy the runtime contract that the entry exposes a named `plugin`.
  if (/\bexport\s+(?:const|let|var|function|class)\s+plugin\b/u.test(source)) return true
  if (/\bexport\s*\{[^}]*\bplugin\b[^}]*\}/u.test(source)) return true
  return false
}

/** Resolve `dsh.native.entry` ('.' or './x') to candidate files inside the package. */
function entryCandidates(directory: string, entry: unknown): string[] {
  if (typeof entry !== 'string' || entry === '') return []
  const relative = entry === '.' ? '' : entry.replace(/^\.\//u, '')
  // A package maps `./native` to its source stem; the file lives under `src/`
  // unless the package root itself carries it. Both layouts ship in this repo.
  const bases = relative === ''
    ? [directory, join(directory, 'src')]
    : [join(directory, relative), join(directory, 'src', relative)]
  const candidates: string[] = []
  for (const base of bases) {
    candidates.push(base)
    for (const extension of ['.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']) {
      candidates.push(`${base}${extension}`)
    }
  }
  return candidates
}

const rows = shippedNativeProfileClientComposition('native-web')
const defects: RowDefect[] = []
const missingPackages: string[] = []
const packagesByName = workspacePackagesByName()

for (const row of rows) {
  const directory = packagesByName.get(row.plugin)
  if (directory === undefined) {
    missingPackages.push(row.plugin)
    defects.push({ id: row.id, plugin: row.plugin, defect: 'package directory is not in the workspace' })
    continue
  }
  const manifest = readManifest(directory)
  if (manifest === undefined) {
    defects.push({ id: row.id, plugin: row.plugin, defect: 'package.json is missing or is not valid JSON' })
    continue
  }

  const native = manifest.dsh?.native
  if (native === null || typeof native !== 'object' || Array.isArray(native)) {
    defects.push({
      id: row.id,
      plugin: row.plugin,
      defect: 'dsh.native is not an object (packaging fails with "native manifest must be an object")',
    })
    continue
  }

  const record = native as Record<string, unknown>
  const targets = record.targets
  if (!Array.isArray(targets) || !targets.includes('client')) {
    defects.push({
      id: row.id,
      plugin: row.plugin,
      defect: `dsh.native.targets does not include 'client' (found ${JSON.stringify(targets)})`,
    })
  }

  const exportsField = manifest.exports
  if (exportsField === null || typeof exportsField !== 'object' || Array.isArray(exportsField)
    || !Object.hasOwn(exportsField, './native')) {
    defects.push({ id: row.id, plugin: row.plugin, defect: "package.json exports does not publish './native'" })
  }

  const candidates = entryCandidates(directory, record.entry)
  const present = candidates.filter(candidate => existsSync(candidate) && statSync(candidate).isFile())
  if (present.length === 0) {
    defects.push({
      id: row.id,
      plugin: row.plugin,
      defect: `dsh.native.entry (${JSON.stringify(record.entry)}) names no existing file`,
    })
  } else {
    const exporting = present.find(file => exportsNamedPlugin(file))
    if (exporting === undefined) {
      defects.push({
        id: row.id,
        plugin: row.plugin,
        defect: `dsh.native.entry (${JSON.stringify(record.entry)}) exists but exports no named 'plugin'`,
      })
    }
  }
}

if (defects.length === 0) {
  console.log(
    `${GATE}: ${rows.length} native-web Client installation row(s) checked,`
    + ' every row names a loadable Native Client.',
  )
  process.exit(0)
}

console.error(
  `${GATE}: ${defects.length} defect(s) across ${rows.length} native-web Client installation row(s).`
  + ' Each one fails Desktop packaging inside prepare-dsh -> smoke-runtime.',
)
for (const defect of defects) {
  console.error(`  ${defect.id}  ${defect.plugin}`)
  console.error(`      ${defect.defect}`)
}
if (missingPackages.length > 0) {
  console.error('')
  console.error('Packages not found in the workspace:')
  for (const name of missingPackages) console.error(`  ${name}`)
}
process.exit(1)
