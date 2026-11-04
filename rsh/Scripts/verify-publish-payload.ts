/**
 * Verify that every packed npm tarball published from this workspace can
 * resolve each module specifier its own JavaScript carries.
 *
 * Three defects of one family all pass every source-plane gate and only appear
 * after packing:
 *
 *   1. The build never emits the advertised `exports["./native"]` target.
 *   2. The file is emitted but the `files` list omits it, so `npm pack` drops it.
 *   3. The file ships but a bare specifier it imports is declared only in
 *      `devDependencies`, so no consumer installs the package that answers it.
 *
 * `verify-native-build-output` covers 1 and 2 for the rows of the two shipped
 * compositions by reading the working tree. This gate is the payload-plane
 * counterpart: it runs the real `npm pack`, unpacks the bytes npm would
 * publish, and asserts that every specifier inside the payload resolves —
 * either to a member of the same tarball (relative specifiers) or to a package
 * the manifest installs (bare specifiers).
 *
 * Scope is every non-private workspace package that publishes
 * `exports["./native"]`. That export is what a Native composition resolves, so
 * a defect there reaches the Desktop runtime, not a test.
 *
 * ## Which bare specifiers are legal outside the installing sections
 *
 * The base rule is that a bare specifier must appear in the package's
 * `dependencies`, `peerDependencies`, or `optionalDependencies`: a consumer's
 * install materializes exactly those. `devDependencies` is a development
 * relationship and installs nothing for a consumer, so a bare specifier found
 * only there cannot resolve in an installed payload.
 *
 * Two exemptions are read from existing policy rather than listed here:
 *
 * - {@link PLATFORM_MODULES} — the shell's frozen module table. The repository
 *   keeps these out of package manifests on purpose ("Baseline externals are
 *   implicit for every dynamic bundle. Do not repeat React, Cordis,
 *   `client/store`, `ui-primitives`, `ui-slots`, or `ui-dockkit` in package
 *   manifests", `rsh/Programs/Web/client/AGENTS.md`), and every client build
 *   preset externalizes them against that table. Importing the constant keeps
 *   this gate from restating a baseline that is already owned elsewhere.
 * - The package's own `dsh.client.external` entries. That declaration is an
 *   exact module-table request whose supplier is the dynamic row or a static
 *   table key (`rsh/Programs/Web/client/AGENTS.md`, "Shared modules and the
 *   module graph"), so it likewise installs nothing of its own.
 *
 * Everything else is reported. `node:` builtins and same-package subpaths are
 * not package relationships at all and are excluded before the rule applies.
 */

import { execFile } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'
import {
  PLATFORM_MODULES,
  PRELOADED_CLIENT_EXTERNALS,
} from '../Compatibility/DSH/web/frontend/src/platform.ts'
import { WORKSPACE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'

const GATE = 'verify-publish-payload'
const root = resolve(import.meta.dirname, '..', '..')

/** Dependency sections that make a bare specifier resolvable in an installed payload. */
const INSTALLING_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

/** One module specifier a packed payload cannot resolve. */
export interface PayloadViolation {
  /** Package name from the packed manifest. */
  readonly package: string
  /** Payload-relative file carrying the specifier, or the export key for an entry defect. */
  readonly file: string
  /** The offending specifier, or the advertised target when the entry itself is missing. */
  readonly specifier: string
  /** Why this specifier does not resolve, in one sentence. */
  readonly reason: string
}

/** What `npm pack` produced for one package, normalized to payload-relative paths. */
export interface PackedPayload {
  /** The manifest inside the tarball, which is what a consumer installs. */
  readonly manifest: Readonly<Record<string, unknown>>
  /** Payload-relative path to file text, for every member npm publishes. */
  readonly files: ReadonlyMap<string, string>
}

/**
 * The package name a bare specifier names.
 * @param specifier - a module specifier, possibly with a subpath.
 * @returns The package name, keeping a leading scope.
 */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0] ?? specifier
}

/**
 * Whether a specifier names a package rather than a file beside its importer.
 * @param specifier - a module specifier.
 * @returns True for a bare specifier; false for relative, absolute, virtual, and builtin targets.
 */
export function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.')
    && !specifier.startsWith('/')
    && !specifier.startsWith('\0')
    && !specifier.startsWith('node:')
}

/**
 * Paths, relative to the payload root, that a relative specifier may resolve to.
 *
 * The emitted files of this workspace are ESM with explicit extensions, so the
 * literal target is tried first. The remaining candidates cover the forms a
 * bundler or a declaration reader emits: an extensionless import resolved to a
 * sibling, and a directory import resolved to its index.
 * @param from - payload-relative path of the importing file.
 * @param specifier - the relative specifier as written.
 * @returns Candidate payload paths, most specific first.
 */
export function resolutionCandidates(from: string, specifier: string): string[] {
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier))
  const base = joined.replace(/\/+$/u, '')
  return [
    joined,
    ...['.js', '.mjs', '.cjs', '.d.ts', '.json'].map(suffix => base + suffix),
    ...['/index.js', '/index.mjs', '/index.cjs', '/index.d.ts'].map(suffix => base + suffix),
  ]
}

/** One module specifier found in an emitted file. */
export interface ModuleSpecifier {
  /** The specifier exactly as written. */
  readonly specifier: string
  /** 1-based line carrying it. */
  readonly line: number
}

/**
 * Static module specifiers one emitted JavaScript file carries.
 *
 * Reads the full ECMAScript surface a bundle can produce: static imports,
 * re-exports, dynamic `import()`, and `require`. An emitted file is plain
 * JavaScript, so the parser runs in JavaScript mode over the file text.
 * @param file - file name used in parser diagnostics only.
 * @param source - file text.
 * @returns Every module specifier the file names, in source order.
 */
export function moduleSpecifiersOf(file: string, source: string): ModuleSpecifier[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const found: ModuleSpecifier[] = []
  const record = (node: ts.Node, literal: ts.Expression | undefined): void => {
    if (literal === undefined || !ts.isStringLiteralLike(literal)) return
    found.push({
      specifier: literal.text,
      line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
    })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node, node.moduleSpecifier)
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      record(node, node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return found
}

/**
 * Whether one dependency section of a manifest lists a package.
 * @param manifest - the packed manifest.
 * @param section - the dependency field to read.
 * @param name - the package name to look for.
 * @returns True when that section declares the package.
 */
function sectionDeclares(manifest: Readonly<Record<string, unknown>>, section: string, name: string): boolean {
  const declared = manifest[section]
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) return false
  return Object.hasOwn(declared, name)
}

/** Exact module-table specifiers one manifest requests, in addition to the baseline. */
function requestedExternals(manifest: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const client = (manifest.dsh as Record<string, unknown> | undefined)?.client
  if (client === null || typeof client !== 'object' || Array.isArray(client)) return new Set()
  const declared = (client as Record<string, unknown>).external
  if (!Array.isArray(declared)) return new Set()
  return new Set(declared.filter((entry): entry is string => typeof entry === 'string'))
}

/**
 * Why a bare specifier needs no installing section, when existing policy says it does not.
 * @param specifier - the bare specifier as written.
 * @param manifest - the packed manifest.
 * @param platformModules - the shell's frozen module table.
 * @returns The governing rule, or undefined when the specifier must be installed.
 */
export function moduleTableExemption(
  specifier: string,
  manifest: Readonly<Record<string, unknown>>,
  platformModules: ReadonlySet<string> = new Set(PLATFORM_MODULES),
): string | undefined {
  if (platformModules.has(specifier)) {
    return 'the shell module table supplies it (PLATFORM_MODULES, rsh/Compatibility/DSH/web/frontend/src/platform.ts)'
  }
  if (requestedExternals(manifest).has(specifier)) {
    return 'the package requests it through dsh.client.external, whose supplier is the module table'
  }
  return undefined
}

/**
 * Every specifier one packed payload cannot resolve.
 *
 * The payload is the authority, not the working tree: `files` is the member
 * list npm publishes, and `manifest` is the manifest a consumer installs.
 * @param payload - packed manifest and member text.
 * @param platformModules - module-table baseline; defaults to the shell constant.
 * @returns Violations in payload order, each naming package, file, and specifier.
 */
export function payloadViolations(
  payload: PackedPayload,
  platformModules: ReadonlySet<string> = new Set([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS]),
): PayloadViolation[] {
  const name = typeof payload.manifest.name === 'string' ? payload.manifest.name : '(unnamed)'
  const violations: PayloadViolation[] = []

  const exported = payload.manifest.exports
  const nativeEntry = exported !== null && typeof exported === 'object' && !Array.isArray(exported)
    ? (exported as Record<string, unknown>)['./native']
    : undefined
  const target = typeof nativeEntry === 'string'
    ? nativeEntry
    : (nativeEntry as { default?: unknown } | undefined)?.default
  if (typeof target !== 'string' || target === '') {
    violations.push({
      package: name,
      file: 'package.json',
      specifier: 'exports["./native"]',
      reason: 'declares no default target, so no consumer can resolve the Native entry',
    })
    return violations
  }
  const targetPath = target.replace(/^\.\//u, '')
  if (!payload.files.has(targetPath)) {
    violations.push({
      package: name,
      file: 'package.json',
      specifier: target,
      reason: 'exports["./native"] names a file the tarball does not contain',
    })
    return violations
  }

  for (const [file, source] of payload.files) {
    if (!file.endsWith('.js')) continue
    for (const { specifier, line } of moduleSpecifiersOf(file, source)) {
      const where = `${file}:${String(line)}`
      // A builtin resolves from Node itself and is not a payload or a package
      // relationship, so neither rule applies to it.
      if (specifier.startsWith('node:')) continue
      if (!isBareSpecifier(specifier)) {
        if (!resolutionCandidates(file, specifier).some(candidate => payload.files.has(candidate))) {
          violations.push({
            package: name,
            file: where,
            specifier,
            reason: 'the tarball contains no file this relative specifier resolves to',
          })
        }
        continue
      }
      if (packageNameOf(specifier) === name) continue
      if (moduleTableExemption(specifier, payload.manifest, platformModules) !== undefined) continue
      if (INSTALLING_SECTIONS.some(section => sectionDeclares(payload.manifest, section, packageNameOf(specifier)))) continue
      const developmentOnly = sectionDeclares(payload.manifest, 'devDependencies', packageNameOf(specifier))
      violations.push({
        package: name,
        file: where,
        specifier,
        reason: developmentOnly
          ? `${packageNameOf(specifier)} is declared only in devDependencies, which a consumer does not install`
          : `${packageNameOf(specifier)} is declared in no installing dependency section`,
      })
    }
  }
  return violations
}

/** One workspace package that publishes a Native entry. */
interface NativePackage {
  readonly name: string
  readonly directory: string
}

/** Every non-private workspace package whose manifest publishes `exports["./native"]`. */
function nativePackages(): NativePackage[] {
  const packages: NativePackage[] = []
  for (const manifestPath of globSync([...WORKSPACE_MANIFEST_GLOBS], { cwd: root }).sort()) {
    const directory = dirname(resolve(root, manifestPath))
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    if (manifest.private === true) continue
    if (typeof manifest.name !== 'string' || manifest.name === '') continue
    const exported = manifest.exports
    if (exported === null || typeof exported !== 'object' || Array.isArray(exported)) continue
    if (!Object.hasOwn(exported, './native')) continue
    packages.push({ name: manifest.name, directory })
  }
  return packages
}

/** Run one child process to completion and return its standard output. */
const run = promisify(execFile)

/**
 * Start a packaged command the way this repository starts pnpm and npm.
 *
 * Windows exposes `npm` only as a `.cmd` shim, which `execFile` cannot start
 * without a shell (it fails with EINVAL). Every argument here is either a
 * literal or a path this gate created, so the shell adds no quoting surface.
 * @param command - executable name.
 * @param args - command arguments.
 * @param cwd - working directory for the child.
 * @returns The child's standard output.
 */
function runTool(command: string, args: readonly string[], cwd: string): Promise<string> {
  return run(command, [...args], {
    cwd,
    shell: process.platform === 'win32',
    maxBuffer: 1 << 28,
  }).then(result => result.stdout)
}

/**
 * Pack one package into the staging directory and read the payload back.
 *
 * `npm pack` writes the tarball; `tar` then unpacks that exact file, so the
 * analyze step reads the bytes a consumer would install rather than the working
 * tree. Every tar invocation uses a staging-relative path because the GNU tar on
 * the Windows runner reads a leading drive letter as a remote host.
 * @param target - the package to pack.
 * @param staging - absolute directory receiving both the tarball and its unpacked tree.
 * @returns The packed payload, or the reason npm could not produce one.
 */
async function packPayload(
  target: NativePackage,
  staging: string,
): Promise<{ payload?: PackedPayload; failure?: string }> {
  let filename: string
  try {
    const packed = await runTool('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', staging], target.directory)
    const parsed = JSON.parse(packed) as { filename?: unknown }[]
    const reported = parsed[0]?.filename
    if (typeof reported !== 'string') return { failure: 'npm pack reported no tarball filename' }
    filename = reported
  } catch (error) {
    return { failure: `npm pack failed: ${String(error).slice(0, 400)}` }
  }

  const unpackedName = filename.replace(/\.tgz$/u, '')
  mkdirSync(join(staging, unpackedName), { recursive: true })
  try {
    await runTool('tar', ['-xzf', filename, '-C', unpackedName], staging)
  } catch (error) {
    return { failure: `tar could not unpack ${filename}: ${String(error).slice(0, 400)}` }
  }

  const payloadRoot = join(staging, unpackedName, 'package')
  const files = new Map<string, string>()
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const memberPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(directory, entry.name), memberPath)
      else files.set(memberPath, readFileSync(join(directory, entry.name), 'utf8'))
    }
  }
  walk(payloadRoot, '')

  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(files.get('package.json') ?? '') as Record<string, unknown>
  } catch {
    return { failure: 'the packed manifest is not valid JSON' }
  }
  return { payload: { manifest, files } }
}

/**
 * Pack and check every package in one bounded pool.
 * @param packages - the packages to check.
 * @param staging - absolute scratch directory owned by this run.
 * @param concurrency - how many `npm pack` children may run at once.
 * @returns One record per package, in input order.
 */
async function checkAll(
  packages: readonly NativePackage[],
  staging: string,
  concurrency: number,
): Promise<{ violations: PayloadViolation[]; failures: string[]; checked: number }> {
  const outcomes: Array<{ violations: PayloadViolation[]; failure?: string } | undefined>
    = Array.from<{ violations: PayloadViolation[]; failure?: string } | undefined>({ length: packages.length })
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, packages.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      const target = packages[index]
      if (target === undefined) return
      const packed = await packPayload(target, staging)
      outcomes[index] = packed.payload === undefined
        ? { violations: [], failure: `${target.name}: ${packed.failure ?? 'no payload'}` }
        : { violations: payloadViolations(packed.payload) }
    }
  }))

  const violations: PayloadViolation[] = []
  const failures: string[] = []
  let checked = 0
  for (const outcome of outcomes) {
    if (outcome === undefined) continue
    if (outcome.failure !== undefined) failures.push(outcome.failure)
    else checked += 1
    violations.push(...outcome.violations)
  }
  return { violations, failures, checked }
}

/**
 * How many `npm pack` children to run at once.
 * @param total - number of packages to check.
 * @returns The pool size, from `RSH_PUBLISH_PAYLOAD_CONCURRENCY` when set.
 * @throws {Error} when the override is not a positive integer.
 */
export function packConcurrency(total: number): number {
  const raw = process.env.RSH_PUBLISH_PAYLOAD_CONCURRENCY
  if (raw === undefined || raw === '') return Math.max(1, Math.min(total, availableParallelism()))
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`${GATE}: RSH_PUBLISH_PAYLOAD_CONCURRENCY must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return Math.min(total, parsed)
}

if (import.meta.main) {
  const packages = nativePackages()
  if (packages.length === 0) {
    throw new Error(`${GATE}: no workspace package publishes exports["./native"]; the corpus is empty.`)
  }
  const staging = mkdtempSync(join(tmpdir(), 'publish-payload-'))
  const started = Date.now()
  try {
    const { violations, failures, checked } = await checkAll(packages, staging, packConcurrency(packages.length))
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    if (violations.length === 0 && failures.length === 0) {
      console.log(
        `${GATE}: ${String(checked)} packed package(s) with a Native entry resolve every specifier in their payload (${elapsed}s).`,
      )
      process.exit(0)
    }

    console.error(
      `${GATE}: ${String(violations.length)} unresolvable specifier(s) and ${String(failures.length)} pack failure(s) `
      + `across ${String(checked)} packed package(s) (${elapsed}s). A consumer installing these tarballs hits MODULE_NOT_FOUND.`,
    )
    for (const failure of failures) console.error(`  pack failure  ${failure}`)
    for (const violation of violations) {
      console.error(`  ${violation.package}  ${violation.file}`)
      console.error(`      ${violation.specifier}: ${violation.reason}`)
    }
    console.error('')
    console.error('Fix: emit the artifact the export advertises, list it in "files",')
    console.error('and declare every bare specifier the payload imports in dependencies,')
    console.error('peerDependencies, or optionalDependencies.')
    process.exit(1)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
