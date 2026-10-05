/**
 * Package-invariant companion discovery and structural checks.
 * The runtime registry stays product-independent; this gate keeps each
 * published companion complete without requiring synthetic empty companions.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { usesFlattenedPackageDependencies } from './package-dependency-policy.ts'
import { PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES } from './experimental-package-policy.ts'
import { RELEASE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'

/** Package README sentence that records why an invariant companion is omitted. */
const OMITTED_COMPANION_REASON = /No (?:(?:runtime )?invariant )?companion is published(?: because|[.:;—])\s+\S/i

interface PackageManifest {
  name?: string
  dsh?: unknown
  exports?: Record<string, { types?: string; default?: string } | string | null | undefined>
  files?: string[]
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** One package and the files participating in its invariant publication rules. */
export interface PackageInvariantOwner {
  readonly dir: string
  readonly manifestPath: string
  readonly sourcePath: string
  readonly packageName: string
}

/** One gate violation with a repo-relative owner path. */
export interface PackageInvariantViolation {
  readonly path: string
  readonly message: string
}

/** Discover packages that own an invariant companion. */
export function packageInvariantOwners(root: string): PackageInvariantOwner[] {
  return packageInvariantPackages(root)
    .filter(owner => existsSync(resolve(root, owner.sourcePath)))
}

/** Discover every package under the repository package tree. */
function packageInvariantPackages(root: string): PackageInvariantOwner[] {
  const publicExperimentalManifests = PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES.map(directory => `${directory}/package.json`)
  return globSync([...RELEASE_MANIFEST_GLOBS, ...publicExperimentalManifests], { cwd: root })
    .map(path => path.split(sep).join('/'))
    .sort()
    .map((manifestPath) => {
      const manifest = readManifest(resolve(root, manifestPath))
      if (manifest.name === undefined || manifest.name === '') {
        throw new Error(`${manifestPath}: package invariant owner must declare a package name`)
      }
      const dir = dirname(manifestPath)
      return {
        dir,
        manifestPath,
        sourcePath: `${dir}/src/invariant.ts`,
        packageName: manifest.name,
      }
    })
}

/** Return all violations of the package-invariant companion rules. */
export function collectPackageInvariantViolations(root: string): PackageInvariantViolation[] {
  const violations: PackageInvariantViolation[] = []
  for (const owner of packageInvariantPackages(root)) {
    const manifest = readManifest(resolve(root, owner.manifestPath))
    const hasCompanion = existsSync(resolve(root, owner.sourcePath))
    checkManifest(owner, manifest, hasCompanion, violations)
    checkBuild(owner, root, hasCompanion, violations)
    if (hasCompanion) {
      checkSource(owner, root, violations)
    } else {
      checkOmissionReason(owner, root, violations)
    }
  }
  return violations
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function addViolation(
  violations: PackageInvariantViolation[],
  path: string,
  message: string,
): void {
  violations.push({ path, message })
}

function checkManifest(
  owner: PackageInvariantOwner,
  manifest: PackageManifest,
  hasCompanion: boolean,
  violations: PackageInvariantViolation[],
): void {
  const invariantExport = manifest.exports?.['./invariant']
  if (!hasCompanion) {
    if (invariantExport !== undefined) {
      addViolation(
        violations,
        owner.manifestPath,
        'exports["./invariant"] must be omitted when src/invariant.ts is absent',
      )
    }
    if (manifest.files?.includes('lib/invariant.js')) {
      addViolation(
        violations,
        owner.manifestPath,
        'files must omit lib/invariant.js when src/invariant.ts is absent',
      )
    }
    return
  }
  if (typeof invariantExport !== 'object'
    || invariantExport === null
    || invariantExport.types !== './lib/types/invariant.d.ts'
    || invariantExport.default !== './lib/invariant.js') {
    addViolation(
      violations,
      owner.manifestPath,
      'exports["./invariant"] must target ./lib/types/invariant.d.ts and ./lib/invariant.js',
    )
  }
  if (!manifest.files?.includes('lib/invariant.js')) {
    addViolation(violations, owner.manifestPath, 'files must publish lib/invariant.js')
  }
  if (owner.packageName === '@deepseek-ai/dsh-invariants') return
  const developmentOnlyInvariant = usesFlattenedPackageDependencies(
    owner.manifestPath,
    owner.packageName,
    manifest.dsh,
  )
  const expectedRange = 'workspace:^'
  const peerRange = manifest.peerDependencies?.['@deepseek-ai/dsh-invariants']
  if (developmentOnlyInvariant ? peerRange !== undefined : peerRange !== expectedRange) {
    addViolation(violations, owner.manifestPath, developmentOnlyInvariant
      ? '@deepseek-ai/dsh-invariants must not be a peerDependency under this package dependency policy'
      : '@deepseek-ai/dsh-invariants must be a workspace:^ peerDependency')
  }
  if (manifest.devDependencies?.['@deepseek-ai/dsh-invariants'] !== expectedRange) {
    addViolation(
      violations,
      owner.manifestPath,
      `@deepseek-ai/dsh-invariants must be a ${expectedRange} devDependency`,
    )
  }
}

function checkBuild(
  owner: PackageInvariantOwner,
  root: string,
  hasCompanion: boolean,
  violations: PackageInvariantViolation[],
): void {
  const tsconfigPath = `${owner.dir}/tsconfig.json`
  if (hasCompanion
    && owner.packageName !== '@deepseek-ai/dsh-invariants'
    && !projectReferencesInvariants(root, owner.dir, tsconfigPath)) {
    addViolation(
      violations,
      tsconfigPath,
      'TypeScript project references must include ../../../Core/runtime-diagnostics/invariants',
    )
  } else if (!hasCompanion && projectReferencesInvariants(root, owner.dir, tsconfigPath)) {
    addViolation(
      violations,
      tsconfigPath,
      'TypeScript project references must omit ../../../Core/runtime-diagnostics/invariants when src/invariant.ts is absent',
    )
  }

  const configPath = `${owner.dir}/tsdown.config.ts`
  if (!existsSync(resolve(root, configPath))) return
  const source = readFileSync(resolve(root, configPath), 'utf8')
  const entries = inspectTsdownEntries(source, root, configPath)
  if (!entries.supported) {
    addViolation(violations, configPath, 'package build override has an unsupported entry declaration')
    return
  }
  const bundlesCompanion = entries.includesInvariant
  if (hasCompanion && !bundlesCompanion) {
    addViolation(violations, configPath, 'package build override must bundle lib/types/invariant.js')
  } else if (!hasCompanion && bundlesCompanion) {
    addViolation(
      violations,
      configPath,
      'package build override must omit lib/types/invariant.js when src/invariant.ts is absent',
    )
  }
}

interface TsdownEntryScan {
  readonly supported: boolean
  readonly includesInvariant: boolean
}

type TsdownConfigHelper = 'clientBundle' | 'clientLibrary' | 'clientOnly' | 'defineConfig' | 'entry' | 'staticLinked'

interface TsdownEntryContext {
  readonly helpers: ReadonlyMap<string, TsdownConfigHelper>
  readonly localFactories: ReadonlyMap<string, ts.Expression>
}

/** Inspect only entry declarations whose helper binding and source values are static. */
function inspectTsdownEntries(source: string, root: string, configPath: string): TsdownEntryScan {
  const absolutePath = resolve(root, configPath)
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const defaultExport = sourceFile.statements.find(ts.isExportAssignment)
  if (defaultExport === undefined) return unsupportedEntryScan()
  const context = {
    helpers: importedTsdownHelpers(sourceFile, root, absolutePath),
    localFactories: topLevelConstInitializers(sourceFile),
  }
  return inspectConfigExpression(defaultExport.expression, context)
}

function importedTsdownHelpers(
  sourceFile: ts.SourceFile,
  root: string,
  configPath: string,
): Map<string, TsdownConfigHelper> {
  const helpers = new Map<string, TsdownConfigHelper>()
  const ambiguous = new Set<string>()
  const clientBuildSource = resolve(root, 'rsh/Programs/Web/client/tsdown.client.ts')
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword || clause.namedBindings === undefined
      || !ts.isNamedImports(clause.namedBindings)) continue
    const moduleName = statement.moduleSpecifier.text
    const clientBuildImport = moduleName.startsWith('.')
      && resolve(dirname(configPath), moduleName) === clientBuildSource
    for (const specifier of clause.namedBindings.elements) {
      if (specifier.isTypeOnly) continue
      const importedName = specifier.propertyName?.text ?? specifier.name.text
      const helper = moduleName === 'tsdown' && (importedName === 'defineConfig' || importedName === 'entry')
        ? importedName
        : clientBuildImport && (importedName === 'clientBundle' || importedName === 'clientLibrary'
          || importedName === 'clientOnly' || importedName === 'staticLinked')
          ? importedName
          : undefined
      const localName = specifier.name.text
      if (helper === undefined) continue
      if (helpers.has(localName) || ambiguous.has(localName)) {
        helpers.delete(localName)
        ambiguous.add(localName)
      } else {
        helpers.set(localName, helper)
      }
    }
  }
  return helpers
}

function topLevelConstInitializers(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>()
  const ambiguous = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)
      || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      const name = declaration.name.text
      if (initializers.has(name) || ambiguous.has(name)) {
        initializers.delete(name)
        ambiguous.add(name)
      } else {
        initializers.set(name, declaration.initializer)
      }
    }
  }
  return initializers
}

function inspectConfigExpression(expression: ts.Expression, context: TsdownEntryContext): TsdownEntryScan {
  if (ts.isObjectLiteralExpression(expression)) return inspectConfigObject(expression)
  if (ts.isArrayLiteralExpression(expression)) {
    return combineEntryScans(expression.elements.map(element =>
      ts.isSpreadElement(element) ? unsupportedEntryScan() : inspectConfigExpression(element, context)))
  }
  if (ts.isArrowFunction(expression)) {
    return inspectConfigFactory(expression, context)
  }
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return unsupportedEntryScan()
  }

  const helper = context.helpers.get(expression.expression.text)
  if (helper === undefined) return unsupportedEntryScan()
  switch (helper) {
    case 'defineConfig': {
      const config = expression.arguments[0]
      return expression.arguments.length === 1 && config !== undefined
        && !ts.isArrowFunction(config) && !ts.isFunctionExpression(config)
        ? inspectConfigExpression(config, context)
        : unsupportedEntryScan()
    }
    case 'entry': {
      const entry = expression.arguments[0]
      return expression.arguments.length === 1 && entry !== undefined
        ? inspectEntryValue(entry) : unsupportedEntryScan()
    }
    case 'clientBundle':
      return inspectClientBundle(expression.arguments, context)
    case 'clientLibrary':
    case 'staticLinked': {
      const entries = expression.arguments[1]
      return expression.arguments.length === 2 && entries !== undefined
        ? inspectEntryValue(entries) : unsupportedEntryScan()
    }
    case 'clientOnly': {
      const config = expression.arguments[0]
      return expression.arguments.length === 1 && config !== undefined
        ? inspectConfigExpression(config, context) : unsupportedEntryScan()
    }
  }
  return assertNeverTsdownHelper(helper)
}

function assertNeverTsdownHelper(helper: never): never {
  throw new Error(`unhandled package-invariant build helper: ${String(helper)}`)
}

function inspectConfigObject(config: ts.ObjectLiteralExpression): TsdownEntryScan {
  const properties = config.properties.filter(property => propertyNameIsEntry(property.name))
  if (properties.length === 0) {
    return config.properties.some(property => ts.isSpreadAssignment(property)
      || ts.isComputedPropertyName(property.name))
      ? unsupportedEntryScan() : { supported: true, includesInvariant: false }
  }
  const entry = properties[0]
  if (properties.length !== 1 || entry === undefined || !ts.isPropertyAssignment(entry)) return unsupportedEntryScan()
  const entryIndex = config.properties.indexOf(entry)
  if (config.properties.slice(entryIndex + 1).some(property => ts.isSpreadAssignment(property)
    || ts.isComputedPropertyName(property.name))) return unsupportedEntryScan()
  return inspectEntryValue(entry.initializer)
}

function inspectClientBundle(args: ts.NodeArray<ts.Expression>, context: TsdownEntryContext): TsdownEntryScan {
  const entries = args[1]
  if (args.length < 2 || args.length > 3 || entries === undefined) return unsupportedEntryScan()
  const primary = inspectEntryValue(entries)
  if (!primary.supported || args[2] === undefined) return primary
  const options = args[2]
  if (!ts.isObjectLiteralExpression(options)) return unsupportedEntryScan()
  const companions = options.properties.filter(property => propertyNameIs(property.name, 'companions'))
  const libOverrides = options.properties.filter(property => propertyNameIs(property.name, 'lib'))
  if (options.properties.some(property => ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name))) {
    return unsupportedEntryScan()
  }
  if (libOverrides.some(property => !ts.isPropertyAssignment(property)
    || !ts.isObjectLiteralExpression(property.initializer)
    || property.initializer.properties.some(option => ts.isSpreadAssignment(option)
      || ts.isComputedPropertyName(option.name) || propertyNameIs(option.name, 'entry')))) {
    return unsupportedEntryScan()
  }
  if (companions.length === 0) return primary
  const companion = companions[0]
  if (companions.length !== 1 || companion === undefined || !ts.isPropertyAssignment(companion)
    || !ts.isArrayLiteralExpression(companion.initializer)) return unsupportedEntryScan()
  const extra = combineEntryScans(companion.initializer.elements.map(element =>
    ts.isSpreadElement(element) ? unsupportedEntryScan() : inspectConfigExpression(element, context)))
  return extra.supported ? combineEntryScans([primary, extra]) : unsupportedEntryScan()
}

function inspectEntryValue(expression: ts.Expression): TsdownEntryScan {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    if (!isStaticEntryPattern(expression.text)) return unsupportedEntryScan()
    return { supported: true, includesInvariant: patternIncludesInvariantEntry(expression.text) }
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const values = expression.elements
    if (!values.every(isEntryString)) return unsupportedEntryScan()
    return combineEntryScans(values.map(inspectEntryValue))
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const names = new Set<string>()
    const values: ts.Expression[] = []
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)
        || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
        || names.has(property.name.text)
        || !isEntryString(property.initializer)) return unsupportedEntryScan()
      names.add(property.name.text)
      values.push(property.initializer)
    }
    return values.length === 0 ? unsupportedEntryScan() : combineEntryScans(values.map(inspectEntryValue))
  }
  return unsupportedEntryScan()
}

function isEntryString(expression: ts.Expression): expression is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
}

function isStaticEntryPattern(pattern: string): boolean {
  if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[') || pattern.includes(']')) return false
  let depth = 0
  for (const character of pattern) {
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth < 0) return false
  }
  return depth === 0
}

function combineEntryScans(scans: readonly TsdownEntryScan[]): TsdownEntryScan {
  return {
    supported: scans.every(scan => scan.supported),
    includesInvariant: scans.some(scan => scan.includesInvariant),
  }
}

function unsupportedEntryScan(): TsdownEntryScan {
  return { supported: false, includesInvariant: false }
}

function inspectConfigFactory(
  factory: ts.ArrowFunction,
  context: TsdownEntryContext,
): TsdownEntryScan {
  const parameter = factory.parameters[0]
  if (factory.parameters.length !== 1 || parameter === undefined || !ts.isIdentifier(parameter.name)
    || parameter.initializer !== undefined || parameter.questionToken !== undefined
    || parameter.dotDotDotToken !== undefined || ts.isBlock(factory.body)) return unsupportedEntryScan()
  const parameterName = parameter.name.text
  const body = factory.body
  if (ts.isArrayLiteralExpression(body)) {
    return combineEntryScans(body.elements.map(element => ts.isSpreadElement(element)
      ? inspectFactoryInvocation(element.expression, parameterName, context)
      : unsupportedEntryScan()))
  }
  if (!ts.isCallExpression(body) || !ts.isPropertyAccessExpression(body.expression)
    || body.expression.name.text !== 'map' || body.arguments.length !== 1) return unsupportedEntryScan()
  const base = inspectFactoryInvocation(body.expression.expression, parameterName, context)
  const callback = body.arguments[0]
  if (!base.supported || callback === undefined || !ts.isArrowFunction(callback)
    || callback.parameters.length !== 1 || callback.parameters[0] === undefined
    || !ts.isIdentifier(callback.parameters[0].name)
    || callback.parameters[0].initializer !== undefined
    || callback.parameters[0].questionToken !== undefined
    || callback.parameters[0].dotDotDotToken !== undefined
    || ts.isBlock(callback.body)
    || !preservesConfigEntry(callback.body, callback.parameters[0].name.text)) return unsupportedEntryScan()
  return base
}

function inspectFactoryInvocation(
  expression: ts.Expression,
  parameterName: string,
  context: TsdownEntryContext,
): TsdownEntryScan {
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)
    || expression.expression.text === parameterName || expression.arguments.length !== 1) return unsupportedEntryScan()
  const argument = expression.arguments[0]
  if (argument === undefined || !ts.isIdentifier(argument) || argument.text !== parameterName) return unsupportedEntryScan()
  const initializer = context.localFactories.get(expression.expression.text)
  return initializer === undefined ? unsupportedEntryScan() : inspectConfigExpression(initializer, context)
}

function preservesConfigEntry(expression: ts.Expression, parameterName: string): boolean {
  if (ts.isIdentifier(expression)) return expression.text === parameterName
  if (ts.isConditionalExpression(expression)) {
    return isDocumentPreviewClientCondition(expression.condition, parameterName)
      && preservesConfigEntry(expression.whenTrue, parameterName)
      && preservesConfigEntry(expression.whenFalse, parameterName)
  }
  if (!ts.isObjectLiteralExpression(expression)) return false
  const [first, ...overrides] = expression.properties
  return first !== undefined && ts.isSpreadAssignment(first)
    && ts.isIdentifier(first.expression) && first.expression.text === parameterName
    && overrides.every(property => ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name) && !propertyNameIsEntry(property.name))
}

function isDocumentPreviewClientCondition(expression: ts.Expression, configName: string): boolean {
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    || expression.right.kind !== ts.SyntaxKind.TrueKeyword || !ts.isCallExpression(expression.left)
    || !ts.isPropertyAccessExpression(expression.left.expression)
    || expression.left.expression.name.text !== 'endsWith'
    || expression.left.expression.questionDotToken === undefined) return false
  const argument = expression.left.arguments[0]
  if (expression.left.arguments.length !== 1 || argument === undefined || !ts.isStringLiteral(argument)
    || argument.text !== '/client') return false
  const name = expression.left.expression.expression
  return ts.isPropertyAccessExpression(name) && name.name.text === 'name'
    && ts.isIdentifier(name.expression) && name.expression.text === configName
}

function propertyNameIsEntry(name: ts.PropertyName | undefined): boolean {
  return propertyNameIs(name, 'entry')
}

function propertyNameIs(name: ts.PropertyName | undefined, value: string): boolean {
  return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === value
}

function patternIncludesInvariantEntry(pattern: string): boolean {
  const open = pattern.indexOf('{')
  if (open < 0) return pattern === 'lib/types/invariant.js'
  const close = pattern.indexOf('}', open + 1)
  if (close < 0) return false
  const prefix = pattern.slice(0, open)
  const suffix = pattern.slice(close + 1)
  return pattern.slice(open + 1, close).split(',').some(choice =>
    patternIncludesInvariantEntry(`${prefix}${choice}${suffix}`))
}

function checkOmissionReason(
  owner: PackageInvariantOwner,
  root: string,
  violations: PackageInvariantViolation[],
): void {
  const readmePath = `${owner.dir}/README.md`
  const absolutePath = resolve(root, readmePath)
  if (!existsSync(absolutePath) || !OMITTED_COMPANION_REASON.test(readFileSync(absolutePath, 'utf8'))) {
    addViolation(
      violations,
      readmePath,
      'omitted companion requires a README "No ... companion is published" reason sentence',
    )
  }
}

function projectReferencesInvariants(root: string, ownerDir: string, entryPath: string): boolean {
  const ownerRoot = resolve(root, ownerDir)
  const target = resolve(root, 'rsh/Core/runtime-diagnostics/invariants')
  const pending = [resolve(root, entryPath)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const configPath = pending.pop()
    if (configPath === undefined) break
    if (visited.has(configPath)) continue
    visited.add(configPath)
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      references?: Array<{ path?: string }>
    }
    for (const reference of config.references ?? []) {
      if (reference.path === undefined) continue
      const referenced = resolve(dirname(configPath), reference.path)
      if (referenced === target) return true
      if (!referenced.startsWith(`${ownerRoot}${sep}`)) continue
      const childConfig = referenced.endsWith('.json') ? referenced : resolve(referenced, 'tsconfig.json')
      if (existsSync(childConfig)) pending.push(childConfig)
    }
  }
  return false
}

function checkSource(
  owner: PackageInvariantOwner,
  root: string,
  violations: PackageInvariantViolation[],
): void {
  const absolutePath = resolve(root, owner.sourcePath)
  const sourceText = readFileSync(absolutePath, 'utf8')
  if (sourceText.includes('@generated')) {
    addViolation(
      violations,
      owner.sourcePath,
      'invariant companions must be hand-owned and may not carry @generated markers',
    )
  }

  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const constants = topLevelStringConstants(sourceFile)
  const registrations: string[] = []
  const unresolved: number[] = []
  const mismatchedInstallers: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isInvariantRegistration(node.expression)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      const argument = node.arguments[0]
      const packageName = argument === undefined ? undefined : stringValue(argument, constants)
      if (packageName === undefined) unresolved.push(line)
      else registrations.push(packageName)
      const installer = node.arguments[1]
      if (installer === undefined || !ts.isIdentifier(installer) || installer.text !== 'install') {
        mismatchedInstallers.push(line)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  for (const line of unresolved) {
    addViolation(
      violations,
      owner.sourcePath,
      `line ${line}: ctx.invariants.register package name must resolve to a local string constant`,
    )
  }
  for (const line of mismatchedInstallers) {
    addViolation(
      violations,
      owner.sourcePath,
      `line ${line}: ctx.invariants.register must use the checked local install function`,
    )
  }
  if (registrations.length !== 1 || registrations[0] !== owner.packageName) {
    addViolation(
      violations,
      owner.sourcePath,
      `must register exactly its own package name ${JSON.stringify(owner.packageName)}; saw ${JSON.stringify(registrations)}`,
    )
  }
  for (const exportedName of ['name', 'inject', 'apply']) {
    if (!hasNamedExport(sourceFile, exportedName)) {
      addViolation(violations, owner.sourcePath, `must named-export ${exportedName}`)
    }
  }
  if (hasDefaultExport(sourceFile)) {
    addViolation(violations, owner.sourcePath, 'must not default-export; Loader must retain the companion namespace')
  }
  checkInstaller(owner, sourceFile, violations)
}

function checkInstaller(
  owner: PackageInvariantOwner,
  sourceFile: ts.SourceFile,
  violations: PackageInvariantViolation[],
): void {
  let initializer: ts.Expression | undefined
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)
        && declaration.name.text === 'install'
        && declaration.initializer !== undefined) {
        initializer = declaration.initializer
      }
    }
  }
  const installer = initializer === undefined ? undefined : installerFunction(initializer)
  if (installer === undefined) {
    addViolation(violations, owner.sourcePath, 'must declare a local install function for package-owned checks')
    return
  }
  if (ts.isBlock(installer.body) && installer.body.statements.length === 0) {
    addViolation(
      violations,
      owner.sourcePath,
      'empty install function is unnecessary; omit the companion and its publication wiring',
    )
    return
  }
  const reporter = installer.parameters[1]?.name
  if (reporter === undefined || !ts.isIdentifier(reporter)) {
    addViolation(violations, owner.sourcePath, 'install function must accept the bound failure reporter as its second parameter')
    return
  }
  if (!usesIdentifier(installer.body, reporter.text)) {
    addViolation(violations, owner.sourcePath, 'install function must use its bound failure reporter')
  }
}

function usesIdentifier(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name
    || node.getChildren().some(child => usesIdentifier(child, name))
}

function installerFunction(
  initializer: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer
  if (ts.isCallExpression(initializer)
    && ts.isPropertyAccessExpression(initializer.expression)
    && ts.isIdentifier(initializer.expression.expression)
    && initializer.expression.expression.text === 'Object'
    && initializer.expression.name.text === 'assign') {
    const target = initializer.arguments[0]
    if (target !== undefined && (ts.isArrowFunction(target) || ts.isFunctionExpression(target))) return target
  }
  return undefined
}

function topLevelStringConstants(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const constants = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      const value = stringValue(declaration.initializer, constants)
      if (value !== undefined) constants.set(declaration.name.text, value)
    }
  }
  return constants
}

function stringValue(node: ts.Expression, constants: ReadonlyMap<string, string>): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return constants.get(node.text)
  return undefined
}

function isInvariantRegistration(expression: ts.LeftHandSideExpression): boolean {
  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'register'
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.name.text === 'invariants'
}

function hasNamedExport(sourceFile: ts.SourceFile, name: string): boolean {
  return sourceFile.statements.some((statement) => {
    if (!ts.isVariableStatement(statement)
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false
    return statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
  })
}

function hasDefaultExport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return true
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    if (modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return true
    if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined) return false
    if (ts.isNamespaceExport(statement.exportClause)) {
      return statement.exportClause.name.text === 'default'
    }
    return statement.exportClause.elements.some(element => element.name.text === 'default')
  })
}

/** Format violations for the command-line gate. */
export function formatPackageInvariantViolation(
  root: string,
  violation: PackageInvariantViolation,
): string {
  const path = resolve(root, violation.path)
  return `${relative(root, path)}: ${violation.message}`
}
