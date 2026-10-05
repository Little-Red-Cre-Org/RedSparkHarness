/**
 * Reject a static value import of an optional dependency in a shipped entry.
 *
 * A dependency declared in `optionalDependencies`, or as a peer carrying
 * `peerDependenciesMeta.<name>.optional`, may be absent from an installed tree —
 * that absence is what "optional" promises a consumer. A static import is
 * evaluated when the importing module loads, so one absent package turns
 * "this capability is unavailable" into a load failure for everything that
 * reaches the importing module.
 *
 * The way out, in order: import it as a type, which emits nothing and is all
 * that declaration merging needs; or restructure so nothing at module scope
 * needs the package. A dynamic `import()` only moves the failure to first use,
 * so it belongs to a caller that genuinely requires the package and handles its
 * absence. The public `dsh` binary is checked from its static startup closure;
 * on-demand compatibility branches must check availability before importing
 * optional packages and have a built-entry acceptance test.
 *
 * Value-vs-type is decided against a bound Program rather than the import
 * syntax, because `verbatimModuleSyntax` is off: a named import used only in
 * type positions is elided and does not load anything. The decision is
 * deliberately conservative in one direction — a value binding the compiler
 * would elide because nothing references it in a value position is still
 * reported, and the fix it asks for (`import type`, or dropping the binding) is
 * what the published package wants regardless. Both compiler faces are scanned,
 * and only files that ship — a published package's `src` — are subject. A
 * package with Cordis-free exports may make its Cordis peer optional: legacy
 * entries may still load Cordis, while each declared safe export's static source
 * closure may not. The packed-consumer test checks the emitted artifact too.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import ts from 'typescript'
import { mixedNativeLibraryDirectories, nativeCompatibilityOnlyPeers, nativeSafeSourceEntryTargets, nativeSafeSourceSubpaths } from './native-package-policy.ts'
import { parseNativeEntryManifest } from '../Core/runtime-diagnostics/native-runtime/src/manifest.ts'
import { TypeScriptProject, type CompilerFace } from './ts-project.ts'

const root = resolve(import.meta.dirname, '..', '..')

/** Directories whose `src` ships as a published package. */
const PUBLISHED_SOURCE = /^rsh\/.+\/src\//

/** The only binary whose declared legacy branches are preflighted at runtime. */
const OPTIONAL_BINARY_PACKAGE = '@deepseek-ai/dsh'

/** How a manifest marked a dependency optional, for the violation message. */
type OptionalKind = 'optionalDependencies' | 'peerDependenciesMeta'

/**
 * The package name a module specifier resolves to.
 * @param specifier - an import specifier, possibly a subpath.
 * @returns The bare package name, keeping a leading scope.
 */
function packageOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier
}

/**
 * Read a manifest field as a record.
 * @param manifest - parsed manifest.
 * @param field - field name.
 * @returns The field value, or an empty record.
 */
function record(manifest: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = manifest[field]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * The dependencies one manifest allows to be absent.
 * @param manifest - parsed manifest.
 * @returns Each optional package name and how it was marked.
 */
function optionalDependencies(manifest: Record<string, unknown>): Map<string, OptionalKind> {
  const optional = new Map<string, OptionalKind>()
  for (const name of Object.keys(record(manifest, 'optionalDependencies'))) {
    optional.set(name, 'optionalDependencies')
  }
  const peers = record(manifest, 'peerDependencies')
  for (const [name, meta] of Object.entries(record(manifest, 'peerDependenciesMeta'))) {
    if (meta === null || typeof meta !== 'object') continue
    if ((meta as Record<string, unknown>).optional !== true) continue
    // A meta entry for an undeclared peer is check-workspace-constraints' business.
    if (!(name in peers)) continue
    optional.set(name, 'peerDependenciesMeta')
  }
  return optional
}

/** One package directory's optional dependencies, resolved once per directory. */
interface PackageOptionalImports {
  readonly optional: Map<string, OptionalKind>
  readonly exports: Record<string, unknown>
  readonly binSources: readonly string[] | undefined
  readonly nativeTargets: readonly string[] | undefined
}

const optionalByDirectory = new Map<string, PackageOptionalImports>()

/**
 * The optional dependencies of the package owning a source file.
 * @param projectRoot - root the relative path is resolved against.
 * @param relativePath - repository-relative path of a source file.
 * @returns That package's optional dependencies, empty when it declares none.
 */
function optionalFor(projectRoot: string, relativePath: string): PackageOptionalImports {
  const directory = resolve(projectRoot, relativePath.slice(0, relativePath.indexOf('/src/')))
  const cached = optionalByDirectory.get(directory)
  if (cached !== undefined) return cached
  const manifestPath = resolve(directory, 'package.json')
  const parsed: unknown = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const manifest = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
  const optional = optionalDependencies(manifest)
  const exports = record(manifest, 'exports')
  const native = record(manifest, 'dsh').native
  const nativeTargets = native === undefined ? undefined : parseNativeEntryManifest(native, new Set(Object.keys(exports))).targets
  const bin = manifest.bin
  const binTargets = typeof bin === 'string'
    ? [bin]
    : bin !== null && typeof bin === 'object' && !Array.isArray(bin)
      ? Object.values(bin).filter((target): target is string => typeof target === 'string')
      : undefined
  const binSources = manifest.name === OPTIONAL_BINARY_PACKAGE
    && binTargets !== undefined && binTargets.length > 0
    && binTargets.every(target => target.startsWith('lib/') && target.endsWith('.js'))
    ? binTargets.map(target => resolve(directory, 'src', target.slice('lib/'.length, -'.js'.length) + '.ts'))
    : undefined
  const result = {
    optional,
    exports,
    binSources,
    nativeTargets,
  }
  optionalByDirectory.set(directory, result)
  return result
}

/**
 * Source files evaluated from a Cordis-free export, including relative value imports.
 * @param project - the bound compiler face.
 * @param typesPath - declaration path from the package export map.
 * @param directory - owning package directory.
 * @returns The source closure; throws when the export cannot be checked.
 */
function cordisFreeSourceClosure(
  project: TypeScriptProject,
  typesPath: string,
  directory: string,
): Set<string> {
  if (!typesPath.startsWith('./lib/types/') || !typesPath.endsWith('.d.ts')) {
    throw new Error(`optional Cordis peer has an unsupported safe-entry types path: ${typesPath}`)
  }
  const sourcePath = resolve(directory, 'src', typesPath.slice('./lib/types/'.length, -'.d.ts'.length) + '.ts')
  const entry = project.program.getSourceFile(sourcePath)
  if (entry === undefined) throw new Error(`optional Cordis peer has no loaded safe-entry source: ${sourcePath}`)
  const visited = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const source = pending.pop() as ts.SourceFile
    if (visited.has(source.fileName)) continue
    visited.add(source.fileName)
    for (const statement of source.statements) {
      const isImport = ts.isImportDeclaration(statement)
      if (!isImport && !ts.isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue
      const loads = isImport
        ? importLoadsModule(statement, project.checker)
        : exportLoadsModule(statement, project.checker)
      if (!loads || packageOf(specifier.text) === '@deepseek-ai/cordis') continue
      const resolved = ts.resolveModuleName(
        specifier.text,
        source.fileName,
        project.program.getCompilerOptions(),
        ts.sys,
      ).resolvedModule?.resolvedFileName
      if (resolved === undefined && specifier.text.startsWith('.')) {
        throw new Error(`safe source import cannot be resolved: ${source.fileName} -> ${specifier.text}`)
      }
      if (resolved === undefined) continue
      const fromSource = relative(resolve(directory, 'src'), resolved)
      if (fromSource.startsWith('..') || isAbsolute(fromSource)) continue
      const target = project.program.getSourceFile(resolved)
      if (target === undefined) {
        throw new Error(`native source import is absent from the compiler face: ${resolved}`)
      }
      pending.push(target)
    }
  }
  return visited
}

/**
 * Source modules statically evaluated from a package's declared binary entry.
 * @param project - the bound compiler face.
 * @param entryPaths - source files named by the package's `bin` manifest field.
 * @returns The static import closure; dynamic imports remain outside startup.
 */
function binarySourceClosure(project: TypeScriptProject, entryPaths: readonly string[]): Set<string> {
  const entries = entryPaths.map((path) => {
    const source = project.program.getSourceFile(path)
    if (source === undefined) throw new Error(`optional-dependency bin has no loaded source: ${path}`)
    return source
  })
  const visited = new Set<string>()
  const pending = entries
  while (pending.length > 0) {
    const source = pending.pop() as ts.SourceFile
    if (visited.has(source.fileName)) continue
    visited.add(source.fileName)
    for (const statement of source.statements) {
      const isImport = ts.isImportDeclaration(statement)
      if (!isImport && !ts.isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (specifier === undefined || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue
      const loads = isImport
        ? importLoadsModule(statement, project.checker)
        : exportLoadsModule(statement, project.checker)
      if (!loads) continue
      const resolved = ts.resolveModuleName(
        specifier.text,
        source.fileName,
        project.program.getCompilerOptions(),
        ts.sys,
      ).resolvedModule?.resolvedFileName
      if (resolved === undefined) {
        throw new Error(`binary source import cannot be resolved: ${source.fileName} -> ${specifier.text}`)
      }
      const target = project.program.getSourceFile(resolved)
      if (target === undefined) throw new Error(`binary source import is absent from the compiler face: ${resolved}`)
      pending.push(target)
    }
  }
  return visited
}

/**
 * Cordis-free declarations exposed by a mixed Cordis/native package.
 * @param packageImports - manifest metadata for the owning package.
 * @param packageDirectory - absolute package directory.
 * @param projectRoot - TypeScript project root.
 * @param safeSubpaths - package directories and Cordis-free export names.
 * @param face - restrict entries to their declared compiler face when provided.
 * @returns Types entry paths whose runtime source closures must not load Cordis.
 */
function cordisFreeTypesEntries(
  packageImports: PackageOptionalImports,
  packageDirectory: string,
  projectRoot: string,
  safeSubpaths: ReadonlyMap<string, readonly string[]>,
  face?: CompilerFace,
): string[] {
  const directoryName = relative(projectRoot, packageDirectory).replaceAll('\\', '/')
  const subpaths = [...(safeSubpaths.get(directoryName) ?? [])]
  if ('./native' in packageImports.exports) subpaths.push('./native')
  const types: string[] = []
  for (const subpath of subpaths) {
    const targets = subpath === './native'
      ? packageImports.nativeTargets ?? mixedNativeLibraryDirectories.get(directoryName) ?? ['host', 'client']
      : nativeSafeSourceEntryTargets.get(`${directoryName}${subpath.slice(1)}`) ?? ['host', 'client']
    if (face !== undefined && !targets.includes(face)) continue
    const entry = packageImports.exports[subpath]
    const typesPath = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as Record<string, unknown>).types
      : undefined
    if (typeof typesPath !== 'string') {
      throw new Error(`optional Cordis peer safe export has no types entry: ${directoryName} ${subpath}`)
    }
    types.push(typesPath)
  }
  return types
}

/**
 * Whether one binding of an import or re-export names a value.
 * @param name - the local binding name node.
 * @param checker - the program's checker.
 * @returns True when the binding carries value meaning, and on an unresolved
 * symbol, so an unresolvable binding fails closed.
 */
function bindsValue(name: ts.Identifier | ts.StringLiteral, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(name)
  if (symbol === undefined) return true
  const target = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
  return (target.flags & ts.SymbolFlags.Value) !== 0
}

/**
 * Whether an import declaration loads its module at run time.
 * @param declaration - the import declaration.
 * @param checker - the program's checker.
 * @returns True when the emitted module keeps the import.
 */
function importLoadsModule(declaration: ts.ImportDeclaration, checker: ts.TypeChecker): boolean {
  const clause = declaration.importClause
  // A bare `import 'x'` is kept for its side effects.
  if (clause === undefined) return true
  // Only the type phase erases the import. `import defer` still resolves and
  // links the module, deferring evaluation alone, so an absent package fails
  // exactly as it would without the modifier.
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false
  if (clause.name !== undefined) return true
  const bindings = clause.namedBindings
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return true
  return bindings.elements.some(element => !element.isTypeOnly && bindsValue(element.name, checker))
}

/**
 * Whether a re-export loads its module at run time.
 * @param declaration - the export declaration, which carries a module specifier.
 * @param checker - the program's checker.
 * @returns True when the emitted module keeps the re-export.
 */
function exportLoadsModule(declaration: ts.ExportDeclaration, checker: ts.TypeChecker): boolean {
  if (declaration.isTypeOnly) return false
  const clause = declaration.exportClause
  // `export * from 'x'` re-exports whatever values the module has.
  if (clause === undefined || ts.isNamespaceExport(clause)) return true
  return clause.elements.some(element => !element.isTypeOnly && bindsValue(element.name, checker))
}

/**
 * Collect disallowed static value imports of optional dependencies in one face.
 * @param project - a bound repository project.
 * @param safeSubpaths - declared native-safe exports beyond each native entry.
 * @param compatibilityPeers - exact peers required only by a mixed package's legacy entries.
 * @returns One message per violation, sorted by location.
 */
export function collectOptionalImportViolations(
  project: TypeScriptProject,
  safeSubpaths: ReadonlyMap<string, readonly string[]> = nativeSafeSourceSubpaths,
  compatibilityPeers: ReadonlyMap<string, readonly string[]> = nativeCompatibilityOnlyPeers,
): string[] {
  const checker = project.checker
  const violations: string[] = []
  const cordisFreeClosureByDirectory = new Map<string, Set<string>>()
  const binaryClosureByDirectory = new Map<string, Set<string>>()
  for (const sourceFile of project.sourceFiles()) {
    if (sourceFile.isDeclarationFile) continue
    const relativePath = project.relativePath(sourceFile)
    if (!PUBLISHED_SOURCE.test(relativePath)) continue
    const packageImports = optionalFor(project.projectRoot, relativePath)
    const optional = packageImports.optional
    if (optional.size === 0) continue
    const directory = resolve(project.projectRoot, relativePath.slice(0, relativePath.indexOf('/src/')))
    if (packageImports.binSources !== undefined) {
      let closure = binaryClosureByDirectory.get(directory)
      if (closure === undefined) {
        closure = binarySourceClosure(project, packageImports.binSources)
        binaryClosureByDirectory.set(directory, closure)
      }
      if (!closure.has(sourceFile.fileName)) continue
    }

    for (const statement of sourceFile.statements) {
      const isImport = ts.isImportDeclaration(statement)
      if (!isImport && !ts.isExportDeclaration(statement)) continue
      const specifierNode = statement.moduleSpecifier
      if (specifierNode === undefined || !ts.isStringLiteral(specifierNode)) continue
      const kind = optional.get(packageOf(specifierNode.text))
      if (kind === undefined) continue
      if ((packageOf(specifierNode.text) === '@deepseek-ai/cordis'
        || compatibilityPeers.get(relative(project.projectRoot, directory).replaceAll('\\', '/'))?.includes(packageOf(specifierNode.text)))
        && kind === 'peerDependenciesMeta'
        && cordisFreeTypesEntries(packageImports, directory, project.projectRoot, safeSubpaths).length > 0) {
        let closure = cordisFreeClosureByDirectory.get(directory)
        if (closure === undefined) {
          closure = new Set<string>()
          for (const typesPath of cordisFreeTypesEntries(packageImports, directory, project.projectRoot, safeSubpaths, project.face)) {
            for (const source of cordisFreeSourceClosure(project, typesPath, directory)) closure.add(source)
          }
          cordisFreeClosureByDirectory.set(directory, closure)
        }
        if (!closure.has(sourceFile.fileName)) continue
      }
      const loads = isImport
        ? importLoadsModule(statement, checker)
        : exportLoadsModule(statement, checker)
      if (!loads) continue
      const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
      violations.push(
        `${relativePath}:${String(line + 1)} loads ${specifierNode.text} at module scope,`
        + ` declared optional in ${kind}; import it as a type, or restructure so module scope does not need it`,
      )
    }
  }
  return violations.sort((left, right) => left.localeCompare(right))
}

/** CLI entry: list every violation and exit 1, or confirm the invariant holds. */
function main(): void {
  const faces: readonly CompilerFace[] = ['host', 'client']
  const violations = new Set<string>()
  for (const face of faces) {
    for (const violation of collectOptionalImportViolations(new TypeScriptProject(root, face))) {
      violations.add(violation)
    }
  }
  if (violations.size === 0) {
    console.log('verify-optional-dependency-imports: no optional dependency is loaded by a disallowed source entry.')
    return
  }
  console.error(`verify-optional-dependency-imports: ${String(violations.size)} optional dependency load(s) at module scope:`)
  for (const violation of [...violations].sort((left, right) => left.localeCompare(right))) {
    console.error(`  ${violation}`)
  }
  process.exit(1)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
