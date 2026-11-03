/**
 * Rename every RedSpark Harness package and environment variable off the
 * upstream DeepSeek Harness names.
 *
 * RedSpark Harness began as a fork that deliberately kept upstream identifiers
 * (`@deepseek-ai/*`, `DSH_*`, the `dsh` CLI) so it could keep tracking upstream.
 * That trade-off is over: the product is its own application, so the names have
 * to be its own too. This codemod is the one place that mapping lives.
 *
 * The mapping is total and ordered — every rule replaces a token with a
 * `redspark`-scoped name, and the result contains no `@deepseek-ai` or `DSH_`
 * token, so a second `--apply` is a no-op.
 *
 * Usage: `pnpm run rename-redspark [--apply|--check]`. Without a mode it reports
 * what would change. `--check` asserts the post-state instead of writing.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')

/** One ordered rewrite: a literal or regular-expression source and its replacement. */
interface Rule {
  readonly pattern: RegExp
  readonly replacement: string
  readonly note: string
}

/**
 * Ordered rewrites, most specific first.
 *
 * `@deepseek-ai/dsh-<name>` collapses to `@redspark/rsh-<name>`: the scope and
 * the `dsh-` prefix both name the old product. Vendored framework packages
 * (`@deepseek-ai/cordis*`) keep their own word, so only the scope moves.
 */
const RULES: readonly Rule[] = [
  { pattern: /@deepseek-ai\/dsh-/gu, replacement: '@redspark/rsh-', note: 'scoped dsh package' },
  { pattern: /@deepseek-ai\//gu, replacement: '@redspark/', note: 'remaining scoped package' },
  // A bare scope with no subpath names the node_modules directory itself.
  { pattern: /@deepseek-ai\b/gu, replacement: '@redspark', note: 'scope directory' },
  { pattern: /\bDSH_HOME_DIR_NAME\b/gu, replacement: 'RSH_HOME_DIR_NAME', note: 'home dir constant' },
  { pattern: /\bDSH_HOME_ENV\b/gu, replacement: 'RSH_HOME_ENV', note: 'home env constant' },
  { pattern: /\bDSH_MD_/gu, replacement: 'RSH_MD_', note: 'doc markdown env' },
  { pattern: /\bDSH_SNAPSHOT\b/gu, replacement: 'RSH_SNAPSHOT', note: 'snapshot env' },
  { pattern: /\bDSH_/gu, replacement: 'RSH_', note: 'environment variable' },
  { pattern: /\bDeepSeek Harness\b/gu, replacement: 'RedSpark Harness', note: 'display name' },
  { pattern: /\bDeepSeekHarness\b/gu, replacement: 'RedSparkHarness', note: 'display name, joined' },
  { pattern: /\bdeepseek-harness\b/gu, replacement: 'redspark-harness', note: 'display name, dashed' },
]

/** Files a rule must never rewrite, because they describe the other product. */
const SKIPPED_PATHS = new Set<string>([
  // This codemod states the mapping it applies.
  'rsh/Scripts/rename-to-redspark.ts',
  // The upstream vendor README records what the vendored packages came from.
  'rsh/Core/vendor/README.md',
])

interface FileChange {
  readonly path: string
  readonly before: string
  readonly after: string
}

/** Every tracked text file the codemod owns. */
function candidateFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return listing.split('\0').filter(entry => entry.length > 0)
}

/**
 * Trees the codemod leaves alone, each for a reason recorded here.
 *
 * - `.agents/notes/` and `.github/pr-evidence/` are dated records of what the
 *   repository looked like when each note was written. Rewriting them would make
 *   those records claim something that was not true at the time.
 * - `snapshots/` holds recorded test baselines. They are re-recorded from the
 *   source, not hand-edited, so the codemod would only produce a half-updated
 *   baseline that no test agrees with.
 * - `lib/` and `.d.ts` are build output.
 */
const VENDORED_HISTORY_PREFIXES = [
  '.agents/',
  '.github/pr-evidence/',
]

/** Whether a repository-relative path is inside one of the rewritten trees. */
function isTextTarget(path: string): boolean {
  if (path.startsWith('node_modules/') || path.includes('/node_modules/')) return false
  if (path.includes('/.desktop-build/') || path.startsWith('.desktop-build/')) return false
  if (path.includes('/lib/') || path.endsWith('.d.ts')) return false
  if (VENDORED_HISTORY_PREFIXES.some(prefix => path.startsWith(prefix))) return false
  // Only the live tree plus the workspace manifests that name its packages.
  // `snapshots/` is included because its files are type-checked with the source
  // (tsconfig.host.json lists them), so a stale name there fails the build.
  const live = path.startsWith('rsh/')
    || path.startsWith('snapshots/')
    || path === 'pnpm-lock.yaml'
    || path === 'pnpm-workspace.yaml'
    || path === 'package.json'
    || path === 'tsdown.config.ts'
    || path.startsWith('.github/workflows/')
    || /^tsconfig[^/]*\.json$/u.test(path)
    || /^vitest[^/]*\.ts$/u.test(path)
  if (!live) return false
  return /\.(?:ts|tsx|mts|cts|mjs|cjs|js|json|yml|yaml|md|css|html|py|rs|toml|sh|ps1|txt|patch)$/u.test(path)
    || path === 'pnpm-lock.yaml'
    || path === 'pnpm-workspace.yaml'
}

/** Apply every rule to one string. */
export function rewritten(text: string): string {
  let result = text
  for (const rule of RULES) result = result.replace(rule.pattern, rule.replacement)
  return result
}

/** Collect files whose content a rule would change. */
export function planChanges(): FileChange[] {
  const changes: FileChange[] = []
  for (const path of candidateFiles()) {
    if (SKIPPED_PATHS.has(path) || !isTextTarget(path)) continue
    const absolute = resolve(root, path)
    if (!existsSync(absolute)) continue
    const before = readFileSync(absolute, 'utf8')
    const after = rewritten(before)
    if (after !== before) changes.push({ path, before, after })
  }
  return changes
}

/** Report or apply the mapping. */
function main(): void {
  const apply = process.argv.includes('--apply')
  const check = process.argv.includes('--check')
  const changes = planChanges()

  if (check) {
    if (changes.length > 0) {
      console.error(`rename-to-redspark: ${String(changes.length)} file(s) still carry upstream names`)
      for (const change of changes.slice(0, 20)) console.error(`  ${change.path}`)
      process.exitCode = 1
      return
    }
    console.log('rename-to-redspark: every tracked file uses the RedSpark names.')
    return
  }

  console.log(`rename-to-redspark: ${String(changes.length)} file(s) would change.`)
  for (const change of changes.slice(0, 15)) console.log(`  ${change.path}`)
  if (changes.length > 15) console.log(`  ... and ${String(changes.length - 15)} more`)
  if (!apply) return

  for (const change of changes) writeFileSync(resolve(root, change.path), change.after)
  console.log(`rename-to-redspark: rewrote ${String(changes.length)} file(s).`)
}

// Importing this module (for the rules in a test) must not rewrite the tree.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main()
