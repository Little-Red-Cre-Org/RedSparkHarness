/**
 * Keep the RSH package-family table complete: every group directory must have a
 * row in both `rsh/README.md` and `rsh/README.zh.md`, and neither
 * table may name a group that no longer exists.
 *
 * Coverage is the failure this gate exists for. A group can be created with its
 * own README triad and a full package set yet never be added to the table, and
 * nothing else notices: `verify-md-links` only proves that the links which *are*
 * written resolve, so it cannot observe a row that was never written. Both
 * directions are compared here so a rename also surfaces the stale row.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')

/** The READMEs that each carry a copy of the group table, in report order. */
const README_FILES = ['rsh/README.md', 'rsh/README.zh.md'] as const

/** Anchor opening the group-table section, so other tables cannot satisfy the scan. */
const SECTION_ANCHOR = '<a id="package-groups"></a>'

/** A `| [\`group/\`](group/README…) | role |` row, capturing the group name. */
const GROUP_ROW = /^\|\s*\[`([a-z][a-z0-9-]*)\/`\]\([^)]+\)\s*\|/gmu

/**
 * Slice the anchored group-table section, ending where the next rule begins.
 * @param source - Complete README source.
 * @returns The section body, or the whole source when the anchor is absent.
 */
function groupTableSection(source: string): string {
  const start = source.indexOf(SECTION_ANCHOR)
  if (start === -1) return source
  const end = source.indexOf('\n-----', start)
  return end === -1 ? source.slice(start) : source.slice(start, end)
}

/**
 * Read the group names listed in one README's group table, in table order.
 * @param source - Complete README source.
 * @returns Group names captured from the first column of every group row.
 */
export function readGroupTable(source: string): string[] {
  const names: string[] = []
  for (const match of groupTableSection(source).matchAll(GROUP_ROW)) {
    const name = match[1]
    if (name !== undefined) names.push(name)
  }
  return names
}

/**
 * Compare the on-disk group directories against each README's group table.
 * @param groups - Package-family group names found under the RSH physical layout.
 * @param tables - README path to the group names that README lists.
 * @returns One diagnostic per unregistered group, stale row, or duplicate.
 */
export function packageGroupTableErrors(
  groups: readonly string[],
  tables: Readonly<Record<string, readonly string[]>>,
): string[] {
  const entries = Object.entries(tables)
  if (groups.length === 0 || entries.length === 0 || entries.every(([, listed]) => listed.length === 0)) {
    return ['no package group directories or group table rows found; the scan is empty or narrowed']
  }

  const onDisk = new Set(groups)
  const failures: string[] = []

  for (const [file, listed] of entries) {
    const seen = new Set(listed)

    for (const group of groups) {
      if (!seen.has(group)) {
        failures.push(`${file}: \`${group}/\` exists in the RSH physical layout but has no row in the group table — add it beside its siblings, per the rule above that table`)
      }
    }

    for (const group of seen) {
      if (!onDisk.has(group)) {
        failures.push(`${file}: the \`${group}/\` row has no matching RSH group directory — remove the stale row or restore the group`)
      }
    }

    if (seen.size !== listed.length) {
      failures.push(`${file}: the group table has ${String(listed.length)} rows for ${String(seen.size)} distinct groups — a group is listed twice`)
    }
  }

  return failures
}

/** Package-family group names exposed by the RSH physical layout. */
function groupDirectories(): string[] {
  const roots = ['rsh/Core', 'rsh/Engine', 'rsh/Modules/Official', 'rsh/Modules/Community', 'rsh/Compatibility/DSH']
  const names = roots.flatMap(directory => globSync(`${directory}/*`, {
    cwd: root,
    withFileTypes: true,
    exclude: ['**/node_modules/**'],
  }).filter(entry => entry.isDirectory()).map(entry => entry.name))
  if (existsSync(resolve(root, 'rsh/Programs/CLI'))) names.push('cli')
  if (existsSync(resolve(root, 'rsh/Programs/ACP/packages'))) names.push('acp')
  if (existsSync(resolve(root, 'rsh/Programs/SDK/packages'))) names.push('sdk')
  for (const name of ['api', 'host', 'client']) {
    if (existsSync(resolve(root, `rsh/Programs/Web/${name}`))) names.push(name)
  }
  if (existsSync(resolve(root, 'rsh/Tests/test-support'))) names.push('test-support')
  return names.filter(name => name !== 'vendor' && name !== 'native').sort()
}

if (import.meta.main) {
  const groups = groupDirectories()
  const tables = Object.fromEntries(
    README_FILES.map(file => [file, readGroupTable(readFileSync(resolve(root, file), 'utf8'))]),
  )
  const failures = packageGroupTableErrors(groups, tables)

  if (failures.length > 0) {
    console.error('verify-package-groups: violations found:')
    for (const failure of failures) console.error(`  ${failure}`)
    console.error(`\n${README_FILES.join(' and ')} must both list every group in the RSH physical layout`)
    process.exitCode = 1
  } else {
    console.log(`verify-package-groups: ${String(groups.length)} package groups match both README tables.`)
  }
}
