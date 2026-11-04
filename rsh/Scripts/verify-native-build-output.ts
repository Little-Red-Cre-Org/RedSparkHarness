/**
 * Verify that every package a shipped native profile installs actually published
 * the build output its `exports` map advertises.
 *
 * A pre-build gate can only inspect `src/`, but the Host loads `lib/`. A package
 * whose `package.json` advertises `exports["./native"].default = "./lib/native.js"`
 * and whose build never emits that file passes every pre-build check and then fails
 * at Desktop packaging inside `prepare-dsh`, when the Host smoke starts:
 *
 *   native installation <id>: invalid package @scope/pkg
 *     [cause]: Error: Cannot find module '.../node_modules/@scope/pkg/lib/native.js'
 *     code: 'MODULE_NOT_FOUND'
 *
 * That failure is far from its cause: the missing artifact is in a package nobody
 * edited, and the message names the installation row rather than the build step.
 * This gate reports every such package at once, after the build that should have
 * produced the file.
 *
 * It also catches the neighbouring mistake: the file is emitted but the package's
 * `files` list omits it, so a packed tarball ships without it while the working
 * tree looks correct.
 *
 * Both shipped compositions of the Web profile are checked. `installation` rows are
 * the Host packages, and `client` rows are the browser Client packages written into
 * the same Native Desktop project. A Client row is the more fragile of the two: its
 * native entry is a statically linked leaf whose own relative and bare imports must
 * also survive packing, so a stylesheet outside `files` breaks it exactly as a
 * missing `lib/native.js` does.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  shippedNativeProfileClientComposition,
  shippedNativeProfileComposition,
} from '../Programs/CLI/src/native-profile-template.ts'

const GATE = 'verify-native-build-output'
const root = resolve(import.meta.dirname, '..', '..')

/**
 * Which composition a checked row belongs to.
 *
 * `installation` rows are the Host packages the shipped `web` template installs and
 * `client` rows are the browser Client packages the same template writes into the
 * Native Desktop project. Both reach their native entry through the same
 * `exports["./native"]` resolution, so both fail packaging the same way.
 */
type CompositionKind = 'installation' | 'client'

/** One composition row whose advertised native build output this gate requires. */
export interface CompositionRow {
  readonly kind: CompositionKind
  readonly id: string
  readonly plugin: string
}

/**
 * Every row of the composition the Desktop Host and its browser Client actually load,
 * in declaration order.
 *
 * `project-manager.ts` creates the desktop project from the shipped `web` composition
 * (`shippedNativeProfileComposition(home, 'web', platform, ...)`) and writes its Client
 * rows from `shippedNativeProfileClientComposition('web')`, so those are the
 * compositions whose build output must exist. `'desktop'` is not a shipped template
 * name and would throw.
 */
function compositionRows(): CompositionRow[] {
  const scratch = mkdtempSync(join(tmpdir(), 'native-build-output-'))
  try {
    const composition = shippedNativeProfileComposition(scratch, 'web', process.platform)
    const rows: CompositionRow[] = []
    for (const row of composition.installations as readonly { id?: unknown; plugin?: unknown; disabled?: unknown }[]) {
      if (row.disabled === true) continue
      if (typeof row.id !== 'string' || typeof row.plugin !== 'string') continue
      rows.push({ kind: 'installation', id: row.id, plugin: row.plugin })
    }
    for (const row of shippedNativeProfileClientComposition('web')) {
      rows.push({ kind: 'client', id: row.id, plugin: row.plugin })
    }
    return rows
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Index workspace packages by manifest name (directory names do not match names). */
function workspacePackagesByName(): Map<string, string> {
  const index = new Map<string, string>()
  const workspaceFile = join(root, 'pnpm-workspace.yaml')
  if (!existsSync(workspaceFile)) return index

  // Only the `packages:` section holds workspace globs; sibling sections carry
  // dependency overrides whose entries look identical but are package specs.
  const patterns: string[] = []
  let inPackages = false
  for (const line of readFileSync(workspaceFile, 'utf8').split(/\r?\n/u)) {
    if (/^[A-Za-z]/u.test(line)) {
      inPackages = /^packages\s*:/u.test(line)
      continue
    }
    if (!inPackages) continue
    const match = /^\s*-\s*(?:'([^']+)'|"([^"]+)"|([^\s#][^#]*?))\s*$/u.exec(line)
    const pattern = match?.[1] ?? match?.[2] ?? match?.[3]
    if (pattern !== undefined && pattern !== '' && !pattern.startsWith('#')) patterns.push(pattern)
  }

  // Walk each pattern's fixed prefix and then scan downward a bounded depth. Reading
  // the glob's own shape to decide how deep to look is error-prone (`a/*/*` versus
  // `a/*` differ by one level and one miscount silently drops whole trees), so the
  // scan is uniform: a package manifest is a leaf, never a container.
  const MAX_DEPTH = 4
  const seen = new Set<string>()
  const scan = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH || seen.has(directory) || !existsSync(directory)) return
    seen.add(directory)
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
        if (typeof manifest.name === 'string' && manifest.name !== '' && !index.has(manifest.name)) {
          index.set(manifest.name, directory)
        }
      } catch { /* not a parseable manifest */ }
    }
    for (const child of directoryDirectories(directory)) scan(join(directory, child), depth + 1)
  }

  for (const pattern of patterns) {
    const wildcard = pattern.search(/[*?]/u)
    const fixed = wildcard === -1 ? pattern : pattern.slice(0, wildcard)
    // Trim to the last complete path segment so the scan starts at a real directory.
    const prefix = fixed.replace(/[^/]*$/u, '').replace(/\/$/u, '')
    scan(resolve(root, prefix === '' ? '.' : prefix), 0)
  }
  return index
}

/** Directory names inside `directory`, or an empty list when it is not a directory. */
function directoryDirectories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'lib')
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/** One package whose advertised native export has no build output behind it. */
export interface OutputDefect {
  readonly kind: CompositionKind
  readonly id: string
  readonly plugin: string
  readonly directory: string
  readonly defect: string
}

const defects: OutputDefect[] = []
const packages = workspacePackagesByName()
const rows = compositionRows()

/** How many checked rows came from one composition. */
function countOf(kind: CompositionKind): number {
  return rows.filter(row => row.kind === kind).length
}

for (const row of rows) {
  defects.push(...rowDefects(row, packages.get(row.plugin)))
}

/**
 * Every defect one composition row has: a package that cannot supply the build
 * output its `exports["./native"]` map advertises, and a published payload that
 * cannot satisfy the entry's own relative imports.
 *
 * A Client row's native entry is a statically linked leaf, so its relative imports
 * stay relative in the emitted bundle. Publishing the entry while dropping what it
 * imports produces a tarball that resolves the entry and then fails on the first
 * `import "./x.module.css"` — the same packing failure the entry check exists to
 * prevent, one file deeper.
 * @param row - composition row naming the package and the row id used in diagnostics.
 * @param directory - the package directory, or undefined when the workspace does not contain it.
 * @returns every defect found for this row; empty when the row's build output is complete.
 */
export function rowDefects(row: CompositionRow, directory: string | undefined): OutputDefect[] {
  if (directory === undefined) {
    return [{ kind: row.kind, id: row.id, plugin: row.plugin, directory: '(unknown)', defect: 'package is not in the workspace' }]
  }
  let manifest: { exports?: unknown; files?: unknown }
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as typeof manifest
  } catch {
    return [{ kind: row.kind, id: row.id, plugin: row.plugin, directory, defect: 'package.json is not readable' }]
  }

  const exported = manifest.exports
  if (exported === null || typeof exported !== 'object' || Array.isArray(exported)) {
    return [{ kind: row.kind, id: row.id, plugin: row.plugin, directory, defect: 'package.json declares no exports map' }]
  }

  const nativeEntry = (exported as Record<string, unknown>)['./native']
  // The Host resolves `exports["./native"].default`; a bare string form is equivalent.
  const target = typeof nativeEntry === 'string'
    ? nativeEntry
    : (nativeEntry as { default?: unknown } | undefined)?.default
  if (typeof target !== 'string' || target === '') {
    return [{ kind: row.kind, id: row.id, plugin: row.plugin, directory, defect: 'exports["./native"] has no default target' }]
  }

  const targetPath = isAbsolute(target) ? target : resolve(directory, target)
  if (!existsSync(targetPath)) {
    return [{
      kind: row.kind,
      id: row.id,
      plugin: row.plugin,
      directory,
      defect: `exports["./native"] points at ${target}, which does not exist on disk`
        + ' (the package did not build, or the build emits a different file name)',
    }]
  }

  const files = Array.isArray(manifest.files) ? manifest.files.filter((entry): entry is string => typeof entry === 'string') : []
  const covered = (packageRelative: string): boolean =>
    files.some(pattern => globCovers(pattern, packageRelative))

  // A built file that the package's own `files` list omits never reaches a tarball,
  // so packaging fails even though the working tree looks correct.
  const defects: OutputDefect[] = []
  const targetRelative = relative(directory, targetPath).split(sep).join('/')
  if (!covered(targetRelative)) {
    defects.push({
      kind: row.kind,
      id: row.id,
      plugin: row.plugin,
      directory,
      defect: `exports["./native"] resolves to ${targetRelative}, which the package "files" list does not include`,
    })
  }

  // The entry's own relative imports must be published too, or the packed entry is
  // resolvable but unusable.
  for (const imported of relativeImportsOf(targetPath)) {
    const importedPath = resolve(dirname(targetPath), imported)
    const importedRelative = relative(directory, importedPath).split(sep).join('/')
    if (!existsSync(importedPath)) {
      defects.push({
        kind: row.kind,
        id: row.id,
        plugin: row.plugin,
        directory,
        defect: `exports["./native"] imports ${imported}, which the build did not emit`,
      })
    } else if (!covered(importedRelative)) {
      defects.push({
        kind: row.kind,
        id: row.id,
        plugin: row.plugin,
        directory,
        defect: `exports["./native"] imports ${imported}, which the package "files" list does not include`,
      })
    }
  }
  return defects
}

/**
 * Relative module specifiers one emitted entry imports.
 *
 * The statically linked leaf preset keeps relative specifiers verbatim, so what the
 * emitted file imports is what the packed tarball must contain. Bare specifiers are
 * dependencies rather than payload and are out of scope here.
 * @param entryPath - absolute path of the emitted entry.
 * @returns the entry's relative import specifiers, in source order.
 */
export function relativeImportsOf(entryPath: string): string[] {
  let source: string
  try {
    source = readFileSync(entryPath, 'utf8')
  } catch {
    return []
  }
  return [...source.matchAll(/(?:\bfrom|\bimport)\s*"\.\.?\/[^"]*"/gu)]
    .map(match => /"\.\.?\/[^"]*"/u.exec(match[0])?.[0].slice(1, -1))
    .filter((specifier): specifier is string => specifier !== undefined)
}

/**
 * True when a package `files` pattern covers a package-relative path.
 *
 * `**` spans zero or more path segments, exactly as npm reads it, so
 * `lib/types/**&#47;*.js` covers `lib/types/native.js` and not only
 * `lib/types/<dir>/native.js`. Treating a double-star segment as "at least one
 * directory" reports a false defect for every package that publishes a flat types
 * directory.
 */
export function globCovers(pattern: string, target: string): boolean {
  const normalized = pattern.replace(/^\.\//u, '').replace(/\/$/u, '')
  if (normalized === target) return true
  if (!/[*?]/u.test(normalized)) return false
  let source = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized.charAt(index)
    if (char === '*') {
      if (normalized.charAt(index + 1) === '*') {
        if (normalized.charAt(index + 2) === '/') {
          // A two-star segment with a slash matches zero or more whole segments.
          source += '(?:[^/]+/)*'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') { source += '[^/]'; continue }
    source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(`${source}$`, 'u').test(target)
}

if (import.meta.main) {
  if (defects.length === 0) {
    console.log(
      `${GATE}: ${rows.length} row(s) checked (${countOf('installation')} native installation, `
      + `${countOf('client')} native-web Client),`
      + ' every advertised exports["./native"] target and the relative imports it needs exist and are published.',
    )
    process.exit(0)
  }

  console.error(
    `${GATE}: ${defects.length} row(s) of ${rows.length} advertise build output that is missing.`
    + ' Desktop packaging fails inside prepare-dsh with MODULE_NOT_FOUND.',
  )
  for (const defect of defects) {
    console.error(`  [${defect.kind}] ${defect.id}  ${defect.plugin}`)
    console.error(`      ${defect.defect}`)
    console.error(`      package: ${relative(root, defect.directory).split(sep).join('/')}`)
  }
  console.error('')
  console.error('Fix: build the package so exports["./native"].default exists,')
  console.error('and list that file, and anything it imports, in the package "files" array so they are published.')
  process.exit(1)
}
