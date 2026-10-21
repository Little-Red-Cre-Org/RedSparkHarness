/**
 * Doc-sync gate for package-group subsystem references. Every package group
 * either links at least one existing `rsh/Docs/subsystems/` page from its English
 * group README or carries an explicit, justified exemption below.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { parseMarkdown, visitMarkdown } from './markdown.ts'
import { RELEASE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'

const root = resolve(import.meta.dirname, '..', '..')

/**
 * Package groups that do not own a standalone subsystem reference. Reasons
 * are reviewable policy: a new group cannot silently inherit an exemption.
 */
export const GROUPS_WITHOUT_SUBSYSTEM_PAGE: Readonly<Record<string, string>> = {
  'rsh/Programs/ACP/packages': 'Protocol transport entry point; the server package README owns its interoperability contract.',
  'rsh/Compatibility/DSH/boot': 'Shared application-bin boot library rather than a runtime subsystem.',
  'rsh/Compatibility/DSH/bundle': 'Composition patch carriers whose mounted packages own all runtime contracts.',
  'rsh/Modules/Official/hooks': 'External hook-protocol bridges over existing interception points, not a new Harness service.',
  'rsh/Programs/SDK/packages': 'Out-of-process protocol and client packages whose package READMEs own the SDK contracts.',
  'rsh/Core/util': 'Low-level primitives whose business semantics remain with their consuming subsystems.',
}

/** Result of auditing package-group subsystem documentation. */
export interface SubsystemPageAudit {
  /** Package groups discovered from group READMEs or child package manifests. */
  readonly groups: number
  /** Groups carrying at least one direct subsystem-page link. */
  readonly linked: number
  /** Groups covered by an explicit no-page policy. */
  readonly exempt: number
  /** Actionable contract violations. */
  readonly violations: readonly string[]
}

/** Normalize one filesystem glob result to repository slash form. */
function normalize(path: string): string {
  return path.split(sep).join('/')
}

/** Extract the group README directory from a workspace package manifest. */
function groupOfManifest(path: string): string {
  const parts = path.split('/')
  if (parts.length < 4 || parts.at(-1) !== 'package.json') throw new Error(`invalid package path: ${path}`)
  return parts.slice(0, -2).join('/')
}

/** Return canonical subsystem-page targets linked by one group README. */
function subsystemLinks(source: string): string[] {
  const links = new Set<string>()
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'link') return
    const path = node.url.split('#', 1)[0]?.split('?', 1)[0]
    if (path === undefined) return
    const parts = path.split('/')
    const docs = parts.findIndex(part => part.toLowerCase() === 'docs')
    const page = docs < 0 ? undefined : parts[docs + 2]
    if (docs < 0 || parts[docs + 1] !== 'subsystems' || parts.slice(docs + 2).some(part => part === '..')) return
    if (page !== undefined && page !== 'README.md' && !page.endsWith('.zh.md')) links.add(`rsh/Docs/subsystems/${page}`)
  })
  return [...links].sort()
}

/**
 * Audit package-group subsystem ownership for one repository tree.
 * @param scanRoot - repository root containing the RSH physical tree and docs.
 * @param exemptions - groups intentionally carrying no subsystem-page link.
 * @returns counts plus every actionable violation.
 */
export function auditSubsystemPages(
  scanRoot: string = root,
  exemptions: Readonly<Record<string, string>> = GROUPS_WITHOUT_SUBSYSTEM_PAGE,
): SubsystemPageAudit {
  const releaseManifests = globSync([...RELEASE_MANIFEST_GLOBS], { cwd: scanRoot }).map(normalize)
  const fixtureManifests = globSync('rsh/*/*/package.json', { cwd: scanRoot }).map(normalize)
    .filter(path => !['Core', 'Engine', 'Modules', 'Compatibility', 'Programs', 'Tests', 'Docs'].includes(path.split('/')[1] ?? ''))
  const manifests = [...new Set([...releaseManifests, ...fixtureManifests])].sort()
  const groups = new Set(manifests.map(groupOfManifest))
  for (const readme of globSync('rsh/*/README.md', { cwd: scanRoot }).map(normalize)) {
    const group = readme.slice(0, -'/README.md'.length)
    if (!['rsh/Docs', 'rsh/Programs', 'rsh/Tests'].includes(group)) groups.add(group)
  }
  const violations: string[] = []
  let linked = 0
  let exempt = 0

  const groupMatches = (group: string, key: string): boolean => group === key || group.endsWith(`/${key}`)
  for (const [group, reason] of Object.entries(exemptions)) {
    if (![...groups].some(candidate => groupMatches(candidate, group))) {
      violations.push(`exemption ${group}: no matching package group; remove the stale entry`)
    }
    if (reason.trim().length === 0) {
      violations.push(`exemption ${group}: missing justification for omitting a subsystem page`)
    }
  }

  for (const group of [...groups].sort()) {
    const readme = `${group}/README.md`
    const readmePath = resolve(scanRoot, readme)
    if (!existsSync(readmePath)) {
      violations.push(`${readme}: package group has no group README declaring subsystem ownership`)
      continue
    }

    const links = subsystemLinks(readFileSync(readmePath, 'utf8'))
    const isExempt = Object.entries(exemptions).some(([key]) => groupMatches(group, key))
    if (links.length === 0) {
      if (isExempt) {
        exempt += 1
      } else {
        violations.push(
          `${readme}: no reader-visible direct rsh/Docs/subsystems/*.md link; add the owning page and link,`
          + ' or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
        )
      }
      continue
    }

    linked += 1
    if (isExempt) {
      violations.push(`${readme}: links a subsystem page but remains exempt; remove the stale exemption`)
    }
    for (const page of links) {
      if (!existsSync(resolve(scanRoot, page))) {
        violations.push(`${readme}: linked subsystem page does not exist: ${page}`)
      }
    }
  }

  return { groups: groups.size, linked, exempt, violations }
}

/** Run the repository audit as a standalone doc-sync gate. */
function main(): void {
  const audit = auditSubsystemPages()
  if (audit.violations.length > 0) {
    console.error('verify-subsystem-pages: package-group documentation violations found:')
    for (const violation of audit.violations) console.error(`  ${violation}`)
    process.exit(1)
  }
  console.log(
    `verify-subsystem-pages: ${String(audit.groups)} group(s) checked`
    + ` (${String(audit.linked)} linked, ${String(audit.exempt)} explicitly exempt), all conform.`,
  )
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) main()
