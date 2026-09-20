/**
 * Find stale root-relative `packages/...` references to known relocated groups
 * in repo-authored prose and TypeScript. Synthetic references are excluded;
 * this gate does not validate every reference to the current RSH layout.
 */

import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { isSyntheticPackageReference } from './package-path-fixtures.ts'
import { PACKAGE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'
import {
  findReferenceViolations,
  isArchivedAgentNotePath,
  uniqueRepoFiles,
  type ReferenceViolation as Violation,
} from './repo-files.ts'

const root = resolve(import.meta.dirname, '..', '..')

/** Markdown + repo-authored TypeScript that may cite package paths. */
const PATTERNS = [
  'README.md',
  'README.zh.md',
  '.agents/notes/**/*.md',
  'rsh/Docs/**/*.md',
  'rsh/*/*.md',
  'rsh/*/*/*.md',
  ...PACKAGE_MANIFEST_GLOBS.map(pattern =>
    pattern.replace('!(*experimental)', '*').replace('/package.json', '/*.md')),
  'AGENTS.md',
  'rsh/AGENTS.md',
  'rsh/**/*.ts',
]

/** Paths excluded from the scan: built output and vendored upstream source. */
const isExcluded = (p: string): boolean =>
  isArchivedAgentNotePath(p) || p.includes('/lib/') || p.includes('/node_modules/')
  || p.endsWith('.d.ts') || p.startsWith('rsh/Core/vendor/')

/** Package groups that were physically relocated by the first migration step. */
const LEGACY_PACKAGE_GROUPS = new Set([
  'acp', 'api', 'attachment', 'automation', 'boot', 'bundle', 'client',
  'code-runtime', 'compaction', 'context', 'core', 'credentials', 'e2b',
  'extensions', 'experimental', 'feedback', 'fs', 'goal', 'guard', 'hooks',
  'identity', 'interaction', 'jobs', 'llm', 'lsp', 'mcp', 'plan', 'preset',
  'runtime-diagnostics', 'sandbox', 'schedule', 'sdk', 'session',
  'session-query', 'settings', 'shell', 'skill', 'spill', 'storage',
  'subagent', 'subprocess', 'terminal', 'test-support', 'todo', 'typert',
  'util', 'web', 'webhook', 'workflow', 'workspace',
])

/**
 * Match an old `packages/<path>` reference token. The character class is plain path
 * characters only, so a glob (`*`), placeholder (`<`, `>`), or brace expansion
 * (`{`, `}`, `,`) terminates the match before those chars and is never probed —
 * those are patterns, not real paths. A trailing `.`/`/` (e.g. a sentence-ending
 * period) is trimmed before the existence check.
 */
const PKG_REF = /(?<![A-Za-z0-9_/.:-])packages\/[A-Za-z0-9._/-]+/g

function isDriftedPackageReference(ref: string): boolean {
  if (existsSync(resolve(root, ref))) return false
  // Ignore unbuilt `lib/` paths only under an existing depth-two package root:
  // CI runs this gate before build, while stale group-less paths must still fail.
  const parts = ref.split('/')
  const libAt = parts.indexOf('lib')
  if (libAt === 3 && existsSync(resolve(root, parts.slice(0, 3).join('/')))) return false
  // Only a known pre-migration package group is in scope. This excludes
  // illustrative names such as `rsh/server`, `rsh/protocol`, and
  // generated fixture paths that never denoted a repository package.
  const group = ref.split('/')[1]
  return group !== undefined && LEGACY_PACKAGE_GROUPS.has(group)
}

/** Find missing package references whose path names a live package; bare paths, typos, and illustrative skeletons do not count. */
function findViolations(absPath: string): Violation[] {
  return findReferenceViolations(
    root,
    absPath,
    PKG_REF,
    // Remove trailing separators or sentence punctuation matched greedily.
    ref => ref.replace(/[./]+$/, ''),
    ref => !isSyntheticPackageReference(relative(root, absPath).replaceAll('\\', '/'), ref)
      && isDriftedPackageReference(ref),
  )
}

const files = uniqueRepoFiles(root, PATTERNS, isExcluded)
const all = files.flatMap(file => findViolations(file.real))
const checked = files.length

if (all.length === 0) {
  console.log(`verify-package-paths: ${checked} file(s) checked, no stale references to known legacy package groups.`)
  process.exit(0)
}

console.error('verify-package-paths: stale legacy packages/* references found (target does not exist):')
for (const v of all) {
  console.error(`  ${v.file}:${v.line}  ${v.ref}`)
}
process.exit(1)
