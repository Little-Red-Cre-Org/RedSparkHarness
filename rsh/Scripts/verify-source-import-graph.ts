/** Resolve workspace source edges in each compiler face and validate package ownership. */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { nativePackageDirectories, transitionalNativeSourceDirectories } from './native-package-policy.ts'
import { repositoryConfigHost } from './ts-project.ts'
import { WORKSPACE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'

const GATE = 'verify-source-import-graph'
const COMPILER_FACES = ['host', 'client'] as const
type CompilerFace = typeof COMPILER_FACES[number]
type EdgeKind = 'runtime' | 'type'
type DependencySection = 'dependencies' | 'optionalDependencies' | 'peerDependencies' | 'devDependencies'

/** One literal or computed source-level module reference. */
export interface SourceImportReference {
  readonly specifier?: string
  readonly kind: EdgeKind
  readonly line: number
  readonly computed: boolean
}

/** Package identity and dependency sections needed to validate one source edge. */
export interface SourceImportOwner {
  readonly name: string
  readonly directory: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

/** One compiler-owned source file with its package and effective project options. */
interface FaceSource {
  readonly fileName: string
  readonly configPath: string
  readonly options: ts.CompilerOptions
}

interface PackageManifest extends Record<string, unknown> {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface OwnedPackage extends SourceImportOwner {
  readonly manifestPath: string
}

function pathKey(path: string): string {
  const normalized = resolve(path).split(sep).join('/')
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase()
}

function packageNameOf(specifier: string): string | undefined {
  if (isBuiltin(specifier) || specifier.startsWith('.') || specifier.startsWith('/')
    || specifier.startsWith('#') || specifier.includes(':') || specifier.includes('*')) return undefined
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  return parts[0]
}

function runtimeImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (clause === undefined) return true
  if (clause.isTypeOnly) return false
  if (clause.name !== undefined) return true
  const bindings = clause.namedBindings
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return true
  return bindings.elements.length === 0 || bindings.elements.some(element => !element.isTypeOnly)
}

function runtimeReExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false
  const clause = node.exportClause
  if (clause === undefined || ts.isNamespaceExport(clause)) return true
  return clause.elements.length === 0 || clause.elements.some(element => !element.isTypeOnly)
}

/** Collect imports, re-exports, module augmentations, import types, and computed loaders. */
export function collectSourceImportReferences(source: ts.SourceFile): SourceImportReference[] {
  const references = new Map<string, SourceImportReference>()
  const record = (node: ts.Node, argument: ts.Expression | undefined, kind: EdgeKind): void => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source))
    const literal = argument !== undefined && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    const reference: SourceImportReference = {
      ...(literal ? { specifier: (argument as ts.StringLiteralLike).text } : {}),
      kind,
      line: position.line + 1,
      computed: !literal,
    }
    const key = `${reference.specifier ?? '<computed>'}\0${kind}\0${String(reference.line)}`
    references.set(key, reference)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      record(node, node.moduleSpecifier, runtimeImport(node) ? 'runtime' : 'type')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      record(node, node.moduleSpecifier, runtimeReExport(node) ? 'runtime' : 'type')
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node, node.moduleReference.expression, 'runtime')
    } else if (ts.isImportTypeNode(node)) {
      const argument = ts.isLiteralTypeNode(node.argument)
        && (ts.isStringLiteral(node.argument.literal) || ts.isNoSubstitutionTemplateLiteral(node.argument.literal))
        ? node.argument.literal
        : undefined
      record(node, argument, 'type')
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      record(node, node.name, 'type')
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      record(node, node.arguments[0], 'runtime')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...references.values()].sort((left, right) => left.line - right.line
    || (left.specifier ?? '').localeCompare(right.specifier ?? '')
    || left.kind.localeCompare(right.kind))
}

function dependencySections(owner: SourceImportOwner, name: string): DependencySection[] {
  return (['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const)
    .filter(section => Object.hasOwn(owner[section], name))
}

function ownerForPath(path: string, owners: readonly OwnedPackage[]): OwnedPackage | undefined {
  const key = pathKey(path)
  return owners.find(owner => key.startsWith(`${pathKey(owner.directory)}/`))
}

/** Analyze one compiled source file using its importing package's actual TS resolver options. */
export function sourceImportViolations(
  source: ts.SourceFile,
  importer: SourceImportOwner,
  owners: readonly SourceImportOwner[],
  options: ts.CompilerOptions,
  face: CompilerFace,
  strictCordisOwners: ReadonlySet<string> = new Set(),
): string[] {
  const owned = owners as readonly OwnedPackage[]
  const byName = new Map(owners.map(owner => [owner.name, owner]))
  const ownerPaths = [...owned].sort((left, right) => right.directory.length - left.directory.length)
  const violations: string[] = []
  for (const reference of collectSourceImportReferences(source)) {
    if (reference.computed) continue
    const specifier = reference.specifier
    if (specifier === undefined) continue
    const declaredPackageName = packageNameOf(specifier)
    const expectedPackage = declaredPackageName === undefined ? undefined : byName.get(declaredPackageName)
    const resolution = ts.resolveModuleName(specifier, source.fileName, options, ts.sys).resolvedModule
    const resolvedPath = resolution?.resolvedFileName
    const targetOwner = resolvedPath === undefined
      ? expectedPackage
      : ownerForPath(resolvedPath, ownerPaths) ?? expectedPackage
    const location = `${source.fileName}:${String(reference.line)}`

    if (declaredPackageName === '@deepseek-ai/cordis' && strictCordisOwners.has(pathKey(importer.directory))) {
      violations.push(`${location}: ${face} native source owner ${importer.name} imports Cordis via ${JSON.stringify(specifier)}`)
    }

    if (resolvedPath === undefined && (specifier.startsWith('.') || expectedPackage !== undefined)) {
      violations.push(`${location}: ${face} cannot resolve workspace source ${JSON.stringify(specifier)}`)
      continue
    }
    if (targetOwner === undefined) {
      if (declaredPackageName === undefined || declaredPackageName === importer.name) continue
      const sections = dependencySections(importer, declaredPackageName)
      const valid = reference.kind === 'runtime'
        ? sections.some(section => section !== 'devDependencies')
        : sections.length > 0
      if (!valid) {
        const requirement = reference.kind === 'runtime'
          ? 'runtime import requires dependencies, optionalDependencies, or peerDependencies'
          : 'type import requires a declared dependency'
        violations.push(
          `${location}: ${face} ${reference.kind} edge ${importer.name} -> ${declaredPackageName} via ${JSON.stringify(specifier)}: ${requirement}`,
        )
      }
      continue
    }
    if (targetOwner.name === importer.name) continue
    if (expectedPackage !== undefined && targetOwner.name !== expectedPackage.name) {
      violations.push(
        `${location}: ${face} alias ${JSON.stringify(specifier)} resolves to ${targetOwner.name}, not ${expectedPackage.name}`,
      )
    }
    if (targetOwner.name === '@deepseek-ai/cordis' && strictCordisOwners.has(pathKey(importer.directory))) {
      violations.push(`${location}: ${face} native source owner ${importer.name} resolves to Cordis via ${JSON.stringify(specifier)}`)
    }

    const sections = dependencySections(importer, targetOwner.name)
    const valid = reference.kind === 'runtime'
      ? sections.some(section => section !== 'devDependencies')
      : sections.length > 0
    if (!valid) {
      const requirement = reference.kind === 'runtime'
        ? 'runtime import requires dependencies, optionalDependencies, or peerDependencies'
        : 'type import requires a declared workspace dependency'
      violations.push(
        `${location}: ${face} ${reference.kind} edge ${importer.name} -> ${targetOwner.name} via ${JSON.stringify(specifier)}: ${requirement}`,
      )
    }
  }
  return violations
}

function parseProject(configPath: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, repositoryConfigHost)
  if (parsed === undefined) throw new Error(`${GATE}: cannot parse ${configPath}`)
  if (parsed.errors.length > 0) {
    throw new Error(`${GATE}: ${configPath}: ${parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n')}`)
  }
  return parsed
}

function faceSources(root: string, face: CompilerFace): FaceSource[] {
  const rootConfig = resolve(root, `tsconfig.${face}.json`)
  const sources = new Map<string, FaceSource>()
  const visited = new Set<string>()
  const collect = (configPath: string): void => {
    const configKey = pathKey(configPath)
    if (visited.has(configKey)) return
    visited.add(configKey)
    const parsed = parseProject(configPath)
    for (const fileName of parsed.fileNames) {
      if (!/\.[cm]?tsx?$/iu.test(fileName)) continue
      const key = `${pathKey(fileName)}\0${configKey}`
      sources.set(key, { fileName: resolve(fileName), configPath, options: parsed.options })
    }
    for (const reference of parsed.projectReferences ?? []) collect(ts.resolveProjectReferencePath(reference))
  }
  collect(rootConfig)
  return [...sources.values()].sort((left, right) => left.fileName.localeCompare(right.fileName)
    || left.configPath.localeCompare(right.configPath))
}

function readOwners(root: string): OwnedPackage[] {
  const manifests = new Set(globSync(WORKSPACE_MANIFEST_GLOBS, { cwd: root }).map(path => resolve(root, path)))
  const owners: OwnedPackage[] = []
  for (const manifestPath of [...manifests].sort()) {
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    if (typeof manifest.name !== 'string') continue
    owners.push({
      name: manifest.name,
      directory: dirname(resolve(manifestPath)),
      manifestPath,
      dependencies: manifest.dependencies ?? {},
      optionalDependencies: manifest.optionalDependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
      devDependencies: manifest.devDependencies ?? {},
    })
  }
  return owners.sort((left, right) => right.directory.length - left.directory.length)
}

/** Audit both compiler faces across every workspace package source in their referenced projects. */
export function collectSourceImportGraphViolations(root: string): {
  violations: string[]
  edges: number
  owners: number
  sourceEntries: number
  ownersWithoutSource: string[]
  computed: number
} {
  const owners = readOwners(root)
  const ownerPaths = owners
  const strictCordisOwners = new Set([...nativePackageDirectories, ...transitionalNativeSourceDirectories]
    .map(directory => pathKey(resolve(root, directory))))
  const seenEdges = new Set<string>()
  const seenOwners = new Set<string>()
  const violations = new Set<string>()
  let sourceEntries = 0
  let computed = 0
  for (const face of COMPILER_FACES) {
    for (const item of faceSources(root, face)) {
      const importer = ownerForPath(item.fileName, ownerPaths)
      if (importer === undefined) continue
      sourceEntries += 1
      seenOwners.add(importer.name)
      const source = ts.createSourceFile(item.fileName, readFileSync(item.fileName, 'utf8'), ts.ScriptTarget.Latest, true)
      const references = collectSourceImportReferences(source)
      computed += references.filter(reference => reference.computed).length
      for (const reference of references) {
        seenEdges.add(`${face}\0${importer.name}\0${item.fileName}\0${String(reference.line)}\0${reference.specifier ?? '<computed>'}\0${reference.kind}`)
      }
      for (const violation of sourceImportViolations(source, importer, owners, item.options, face, strictCordisOwners)) {
        violations.add(violation)
      }
    }
  }
  return {
    violations: [...violations].sort(),
    edges: seenEdges.size,
    owners: owners.length,
    sourceEntries,
    ownersWithoutSource: owners.filter(owner => !seenOwners.has(owner.name)).map(owner => owner.name).sort(),
    computed,
  }
}

function main(): void {
  const root = resolve(import.meta.dirname, '..', '..')
  const result = collectSourceImportGraphViolations(root)
  const categories = new Map<string, string[]>()
  for (const violation of result.violations) {
    const category = violation.includes('cannot resolve workspace source')
      ? 'unresolved source references (includes CSS/Vite assets)'
      : violation.includes('alias ') && violation.includes(' resolves to ')
        ? 'alias target mismatches'
        : violation.includes(' native source owner ')
          ? 'native Cordis boundary violations'
          : violation.includes('workspace dependency')
            ? 'undeclared workspace dependencies'
            : 'undeclared external dependencies'
    const entries = categories.get(category) ?? []
    entries.push(violation)
    categories.set(category, entries)
  }
  console.log(
    `${GATE}: audited ${String(result.edges)} Host/Client references across ${String(result.sourceEntries)} compiler source entries `
    + `and ${String(result.owners - result.ownersWithoutSource.length)}/${String(result.owners)} package owners; `
    + `${String(result.computed)} are computed loaders.`,
  )
  if (result.ownersWithoutSource.length > 0) {
    console.log(`Owners absent from both compiler faces: ${result.ownersWithoutSource.join(', ')}`)
  }
  console.log(`Existing findings: ${String(result.violations.length)}. This command reports the full repository baseline; it is not a CI gate.`)
  for (const [category, entries] of categories) console.log(`  ${category}: ${String(entries.length)}`)
  if (process.argv.includes('--full')) for (const violation of result.violations) console.log(`  ${violation}`)
  const boundaryViolations = categories.get('native Cordis boundary violations') ?? []
  if (boundaryViolations.length > 0) {
    console.error(`Native Cordis boundary findings: ${String(boundaryViolations.length)}; run verify-native-dependencies for the enforced policy.`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
