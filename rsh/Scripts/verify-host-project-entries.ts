/**
 * Verify that every Host-side test file admitted by `tsconfig.host.json` belongs to
 * a package that the same aggregate lists in `references`.
 *
 * The include list admits tests with globs (`rsh/Programs/Web/api/*&#47;tests/**&#47;*.ts`),
 * while `references` names project directories one by one. A new package therefore
 * gets its tests type-checked as part of the Host aggregate while its own sources are
 * not part of any referenced project, and the build fails with:
 *
 *   TS6307: File '.../src/native.ts' is not listed within the file list of project
 *   '.../tsconfig.host.json'. Projects must list all files or use an 'include' pattern.
 *
 * That error appears minutes into Desktop packaging, in whichever package was added
 * last. This gate reports every such package before any build runs.
 *
 * Only Host-side tests are considered: `exclude` drops Client-face files
 * (`*.client.ts`, `*.client.spec.ts`), so those must not be counted here.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const GATE = 'verify-host-project-entries'
const root = resolve(import.meta.dirname, '..', '..')
const hostConfigPath = join(root, 'tsconfig.host.json')

/** One package whose Host tests are included without a project reference. */
interface UnregisteredPackage {
  readonly packageDirectory: string
  readonly sampleTest: string
  readonly reason: string
}

/** Read a tsconfig file, tolerating the comments these files carry. */
function readTsconfig(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  const source = readFileSync(path, 'utf8')
  // Strip // and /* */ comments outside strings before JSON.parse.
  let output = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index)
    const next = source.charAt(index + 1)
    if (inLineComment) {
      if (char === '\n') { inLineComment = false; output += char }
      continue
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') { inBlockComment = false; index += 1 }
      continue
    }
    if (inString) {
      output += char
      if (char === '\\') { output += next; index += 1 }
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; output += char; continue }
    if (char === '/' && next === '/') { inLineComment = true; index += 1; continue }
    if (char === '/' && next === '*') { inBlockComment = true; index += 1; continue }
    output += char
  }
  try {
    return JSON.parse(output) as Record<string, unknown>
  } catch (error) {
    console.error(`${GATE}: tsconfig.host.json is not parseable: ${String(error)}`)
    process.exit(1)
  }
}

/** Convert a tsconfig glob into an anchored regular expression over repo-relative POSIX paths. */
function globToRegExp(pattern: string): RegExp {
  let out = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` spans zero or more directories.
        if (pattern[index + 2] === '/') { out += '(?:.*/)?'; index += 2 }
        else { out += '.*'; index += 1 }
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (char === '?') { out += '[^/]'; continue }
    out += (char as string).replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(`${out}$`, 'u')
}

const hostConfig = readTsconfig(hostConfigPath)
if (hostConfig === undefined) {
  console.error(`${GATE}: cannot read ${hostConfigPath}`)
  process.exit(1)
}

const includePatterns = (hostConfig.include as string[] | undefined) ?? []
const excludePatterns = (hostConfig.exclude as string[] | undefined) ?? []
const references = (hostConfig.references as { path: string }[] | undefined) ?? []

const includeMatchers = includePatterns.map(globToRegExp)
const excludeMatchers = excludePatterns.map(globToRegExp)

/** True when a repo-relative POSIX path is admitted by include and not dropped by exclude. */
function isAdmitted(path: string): boolean {
  if (!includeMatchers.some(matcher => matcher.test(path))) return false
  return !excludeMatchers.some(matcher => matcher.test(path))
}

/** Every test file under rsh/Programs/Web, repository-relative and POSIX-separated. */
function webTestFiles(): string[] {
  const base = join(root, 'rsh/Programs/Web')
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib') continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.(?:spec|e2e)\.tsx?$/u.test(entry.name)) continue
      // Only files inside a tests/ directory are Host test inputs of interest.
      const parts = relative(base, full).split(sep)
      if (!parts.includes('tests')) continue
      files.push(relative(root, full).split(sep).join('/'))
    }
  }
  if (existsSync(base)) walk(base)
  return files.sort()
}

/** Resolve a package directory from a test file path: the ancestor that owns a package.json. */
function owningPackage(testPath: string): string | undefined {
  let directory = dirname(join(root, testPath))
  // Walk up until a package.json with a `name` is found, stopping at the repo root.
  while (directory.startsWith(root) && directory !== root) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
        if (typeof manifest.name === 'string') return directory
      } catch { /* keep walking */ }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

const referencedPaths = new Set<string>()
for (const reference of references) {
  const resolved = resolve(root, reference.path)
  referencedPaths.add(resolved)
  // A reference may name a directory or a specific tsconfig file.
  referencedPaths.add(dirname(resolved))
}

/**
 * Package names whose `tsconfig.base.json` path mapping points at a source directory.
 *
 * Such a package resolves through `paths` instead of a project reference, so its
 * sources type-check even when it is absent from `references`. TS6307 only fires
 * for a package whose sources are reachable *solely* through the referencing
 * project's own file list.
 */
function sourceMappedPackages(): Set<string> {
  const mapped = new Set<string>()
  const baseConfig = readTsconfig(join(root, 'tsconfig.base.json'))
  const compilerOptions = baseConfig?.compilerOptions as { paths?: Record<string, string[]> } | undefined
  const paths = compilerOptions?.paths ?? {}
  for (const [specifier, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue
    if (targets.some(target => target.includes('/src'))) {
      // `@scope/pkg/native` and `@scope/pkg` both map the same owning package.
      const owner = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (owner !== undefined) mapped.add(owner)
    }
  }
  return mapped
}

const sourceMapped = sourceMappedPackages()

/** Read a package's npm name, or undefined when it has none. */
function packageName(directory: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown }
    return typeof manifest.name === 'string' ? manifest.name : undefined
  } catch {
    return undefined
  }
}

/** True when the test file imports a source file from its own package. */
function importsOwnSource(testPath: string, packageDirectory: string): boolean {
  const source = readFileSync(join(root, testPath), 'utf8')
  // Relative specifiers that resolve inside the package's src/ are what create the
  // TS6307 dependency on the package's own project. A test that only drives the
  // package through node APIs or playwright never needs the package in references.
  for (const match of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/gu)) {
    const specifier = match[1]
    if (specifier === undefined) continue
    const imported = resolve(dirname(join(root, testPath)), specifier)
    if (imported.startsWith(join(packageDirectory, 'src'))) return true
  }
  return false
}

const defects: UnregisteredPackage[] = []
const seen = new Set<string>()

for (const testPath of webTestFiles()) {
  if (!isAdmitted(testPath)) continue
  const packageDirectory = owningPackage(testPath)
  if (packageDirectory === undefined) {
    defects.push({ packageDirectory: dirname(testPath), sampleTest: testPath, reason: 'no owning package.json found' })
    continue
  }
  if (seen.has(packageDirectory)) continue
  seen.add(packageDirectory)

  if (referencedPaths.has(packageDirectory)) continue

  // Only a package whose admitted tests import its own src/ can fail with TS6307.
  // A package that merely hosts a test against node APIs or playwright does not.
  if (!importsOwnSource(testPath, packageDirectory)) continue

  // A package mapped by tsconfig.base.json `paths` to a src directory resolves
  // without a project reference, so it cannot produce TS6307 either.
  const name = packageName(packageDirectory)
  if (name !== undefined && sourceMapped.has(name)) continue

  const hasOwnHostConfig = existsSync(join(packageDirectory, 'tsconfig.host.json'))
  defects.push({
    packageDirectory,
    sampleTest: testPath,
    reason: hasOwnHostConfig
      ? 'package has tsconfig.host.json but is not listed in tsconfig.host.json references'
      : 'package has no tsconfig.host.json and is not listed in tsconfig.host.json references',
  })
}

if (defects.length === 0) {
  console.log(
    `${GATE}: ${seen.size} package(s) with admitted Host tests checked,`
    + ' every one is registered in tsconfig.host.json references.',
  )
  process.exit(0)
}

console.error(
  `${GATE}: ${defects.length} package(s) contribute Host tests but are not registered project references.`
  + ' Type-checking the Host aggregate fails with TS6307 on each.',
)
for (const defect of defects) {
  console.error(`  ${relative(root, defect.packageDirectory).split(sep).join('/')}`)
  console.error(`      ${defect.reason}`)
  console.error(`      e.g. ${defect.sampleTest}`)
}
console.error('')
console.error('Register each package by adding to tsconfig.host.json:')
console.error('  1. a "references" entry: { "path": "./" + the package directory }')
console.error('  2. a host tsconfig in the package that lists its src (include: ["src"])')
console.error('New packages default to Client-only configuration; the Host face needs its own.')
process.exit(1)
