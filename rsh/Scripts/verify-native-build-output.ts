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
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
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
interface CompositionRow {
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
interface OutputDefect {
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
  const directory = packages.get(row.plugin)
  if (directory === undefined) {
    defects.push({
      kind: row.kind,
      id: row.id,
      plugin: row.plugin,
      directory: '(unknown)',
      defect: 'package is not in the workspace',
    })
    continue
  }

  let manifest: { exports?: unknown; files?: unknown; dsh?: { native?: { entry?: unknown } } }
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as typeof manifest
  } catch {
    defects.push({ kind: row.kind, id: row.id, plugin: row.plugin, directory, defect: 'package.json is not readable' })
    continue
  }

  const exported = manifest.exports
  if (exported === null || typeof exported !== 'object' || Array.isArray(exported)) {
    defects.push({
      kind: row.kind,
      id: row.id,
      plugin: row.plugin,
      directory,
      defect: 'package.json declares no exports map',
    })
    continue
  }

  const nativeEntry = (exported as Record<string, unknown>)['./native']
  // The Host resolves `exports["./native"].default`; a bare string form is equivalent.
  const target = typeof nativeEntry === 'string'
    ? nativeEntry
    : (nativeEntry as { default?: unknown } | undefined)?.default
  if (typeof target !== 'string' || target === '') {
    defects.push({
      kind: row.kind,
      id: row.id,
      plugin: row.plugin,
      directory,
      defect: 'exports["./native"] has no default target',
    })
    continue
  }

  const targetPath = isAbsolute(target) ? target : resolve(directory, target)
  if (!existsSync(targetPath)) {
    defects.push({
      kind: row.kind,
      id: row.id,
      plugin: row.plugin,
      directory,
      defect: `exports["./native"] points at ${target}, which does not exist on disk`
        + ' (the package did not build, or the build emits a different file name)',
    })
    continue
  }

  // A built file that the package's own `files` list omits never reaches a tarball,
  // so packaging fails even though the working tree looks correct.
  const files = manifest.files
  if (Array.isArray(files) && files.length > 0) {
    const targetRelative = relative(directory, targetPath).split(sep).join('/')
    if (!files.some(pattern => typeof pattern === 'string' && globCovers(pattern, targetRelative))) {
      defects.push({
        kind: row.kind,
        id: row.id,
        plugin: row.plugin,
        directory,
        defect: `exports["./native"] resolves to ${targetRelative}, which the package "files" list does not include`,
      })
    }
  }
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
function globCovers(pattern: string, target: string): boolean {
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

if (defects.length === 0) {
  console.log(
    `${GATE}: ${rows.length} row(s) checked (${countOf('installation')} native installation, `
    + `${countOf('client')} native-web Client),`
    + ' every advertised exports["./native"] target exists and is published.',
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
console.error('and list that file in the package "files" array so it is published.')
process.exit(1)
