/** Validate native source imports, type references, augmentations and manifest dependencies. */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { parseNativeEntryManifest } from '../Core/runtime-diagnostics/native-runtime/src/manifest.ts'
import { mixedNativeEntryDirectories, mixedNativeLibraryDirectories, nativePackageDirectories, transitionalNativeSourceDirectories } from './native-package-policy.ts'
import { TypeScriptProject } from './ts-project.ts'

/**
 * Inspect module references, including type-only edges and computed loading.
 * @param source - parsed production source.
 * @param resolveAllowed - resolves aliases and package subpaths to an admitted source owner.
 * @param onReference - optional observer for each literal source reference.
 * @returns violations with their source offsets.
 */
export function nativeSourceViolations(
  source: ts.SourceFile,
  resolveAllowed: (specifier: string) => boolean,
  onReference?: (specifier: string) => void,
): string[] {
  const errors: string[] = []
  const check = (node: ts.Node, argument: ts.Node | undefined): void => {
    if (argument === undefined || (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument))) {
      errors.push(`${source.fileName}:${node.getStart(source)}: native source cannot compute a module target`)
    } else if (!resolveAllowed(argument.text)) {
      errors.push(`${source.fileName}:${node.getStart(source)}: native source cannot reference ${argument.text}`)
    }
    if (argument !== undefined && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      onReference?.(argument.text)
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) check(node, node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      check(node, node.moduleReference.expression)
    } else if (ts.isImportTypeNode(node)) {
      check(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument)
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      check(node, node.name)
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      check(node, node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return errors
}

/** Locate the source corresponding to one package export's declaration path. */
function exportSource(directory: string, exportName: string, exports: Record<string, unknown>): string | undefined {
  const entry = exports[exportName]
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const types = (entry as Record<string, unknown>).types
  if (typeof types !== 'string' || !types.startsWith('./lib/types/') || !types.endsWith('.d.ts')) return undefined
  const sourceRoot = resolve(directory, 'src')
  const source = resolve(sourceRoot, types.slice('./lib/types/'.length, -'.d.ts'.length) + '.ts')
  const within = relative(sourceRoot, source)
  return within.startsWith('..') || isAbsolute(within) ? undefined : source
}

/** Follow all source references reachable from one mixed package's native entry. */
function mixedNativeSourceViolations(
  project: TypeScriptProject,
  directory: string,
  manifest: Record<string, unknown>,
  entryName: string,
  resolveAllowed: (sourceFile: string, specifier: string) => boolean,
): string[] {
  const exports = manifest.exports as Record<string, unknown>
  const entryPath = exportSource(directory, entryName, exports)
  if (entryPath === undefined) return [`${directory}: native export ${entryName} has no supported source declaration path`]
  const entry = project.program.getSourceFile(entryPath)
  if (entry === undefined) return [`${directory}: native entry ${entryPath} is absent from the compiler face`]
  const errors: string[] = []
  const visited = new Set<string>()
  const pending = [entry]
  const ownerName = manifest.name
  while (pending.length > 0) {
    const source = pending.pop() as ts.SourceFile
    if (visited.has(source.fileName)) continue
    visited.add(source.fileName)
    errors.push(...nativeSourceViolations(source,
      specifier => resolveAllowed(source.fileName, specifier),
      (specifier) => {
        const selfExport = typeof ownerName === 'string' && (specifier === ownerName || specifier.startsWith(`${ownerName}/`))
          ? specifier === ownerName ? '.' : `.${specifier.slice(ownerName.length)}`
          : undefined
        const resolved = selfExport === undefined
          ? ts.resolveModuleName(specifier, source.fileName, project.program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName
          : exportSource(directory, selfExport, exports)
        if (resolved === undefined) return
        const owner = relative(directory, resolved).replaceAll('\\', '/')
        if (!owner.startsWith('src/')) return
        const next = project.program.getSourceFile(resolved)
        if (next === undefined) errors.push(`${source.fileName}: native source reference ${specifier} is absent from the compiler face`)
        else pending.push(next)
      }))
  }
  return errors
}

/**
 * Check both compiler graphs and reject missing production source coverage.
 * @param root - workspace root with face aggregates and package manifests.
 * @returns all forbidden edges and undiscovered source files.
 */
export function collectNativeDependencyViolations(root: string): string[] {
  const errors = new Set<string>()
  const seen = new Set<string>()
  const mixedEntries = new Map<string, { manifest: Record<string, unknown>; entry: string; targets: readonly string[] }>()
  const ownerOf = (file: string, directories: ReadonlySet<string>): string | undefined => {
    const path = relative(root, file).replaceAll('\\', '/')
    return [...directories].find(dir => path.startsWith(`${dir}/src/`))
  }
  const transitionAllows = (sourceOwner: string, sourceFile: string, specifier: string, options: ts.CompilerOptions): boolean => {
    if (specifier.startsWith('node:')) return true
    if (specifier === '@deepseek-ai/cordis' || specifier.startsWith('@deepseek-ai/cordis/')) return false
    const resolved = ts.resolveModuleName(specifier, sourceFile, options, ts.sys).resolvedModule
    if (resolved === undefined) return false
    const target = relative(root, resolved.resolvedFileName).replaceAll('\\', '/')
    if (target.startsWith('rsh/Core/vendor/cordis/') || target.startsWith('rsh/Compatibility/')
      || target.startsWith('rsh/Programs/')) return false
    if (sourceOwner.startsWith('rsh/Core/') && target.startsWith('rsh/') && !target.startsWith('rsh/Core/')) return false
    return true
  }
  const names = new Set<string>()
  for (const file of globSync('rsh/**/package.json', { cwd: root })) {
    const dir = file.replaceAll('\\', '/').replace(/\/package\.json$/, '')
    const manifest = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as Record<string, unknown>
    const dsh = manifest.dsh
    if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh) || !Object.hasOwn(dsh, 'native')) continue
    if ((dir.startsWith('rsh/Core/') || dir.startsWith('rsh/Engine/') || dir.startsWith('rsh/Modules/'))
      && !nativePackageDirectories.has(dir) && !transitionalNativeSourceDirectories.has(dir)
      && !mixedNativeEntryDirectories.has(dir) && !mixedNativeLibraryDirectories.has(dir)) {
      errors.add(`${dir}: native entry source owner is not classified`)
    }
    try {
      const entry = (dsh as Record<string, unknown>).native
      const exports = manifest.exports
      const names = exports !== null && typeof exports === 'object' && !Array.isArray(exports)
        ? new Set(Object.keys(exports)) : new Set<string>()
      const parsed = parseNativeEntryManifest(entry, names)
      if (mixedNativeEntryDirectories.has(dir)) mixedEntries.set(dir, { manifest, entry: parsed.entry, targets: parsed.targets })
    } catch (error) {
      errors.add(`${file}: ${error instanceof Error ? error.message : 'invalid native manifest'}`)
    }
  }
  for (const dir of mixedNativeEntryDirectories.keys()) {
    if (existsSync(resolve(root, dir, 'package.json')) && !mixedEntries.has(dir)) {
      errors.add(`${dir}: classified mixed package has no valid native entry`)
    }
  }
  for (const dir of mixedNativeLibraryDirectories.keys()) {
    if (!existsSync(resolve(root, dir, 'package.json'))) continue
    const manifest = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')) as Record<string, unknown>
    const exports = manifest.exports as Record<string, unknown> | undefined
    if (exports === undefined || exportSource(resolve(root, dir), './native', exports) === undefined) {
      errors.add(`${dir}: classified mixed library has no valid native export`)
    }
  }
  for (const dir of nativePackageDirectories) {
    const manifest = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')) as { name: string }
    names.add(manifest.name)
  }
  for (const dir of nativePackageDirectories) {
    const manifest = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')) as Record<string, unknown>
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(manifest[field] as Record<string, unknown> | undefined ?? {})) {
        if (!names.has(name)) errors.add(`${dir}: ${field}.${name} is outside the admitted native graph`)
      }
    }
  }
  for (const face of ['host', 'client'] as const) {
    const project = new TypeScriptProject(root, face)
    const options = project.program.getCompilerOptions()
    for (const [dir, mixed] of mixedEntries) {
      if (!mixed.targets.includes(face)) continue
      const directory = resolve(root, dir)
      for (const error of mixedNativeSourceViolations(project, directory, mixed.manifest, mixed.entry,
        (sourceFile, specifier) => transitionAllows(dir, sourceFile, specifier, options))) errors.add(error)
    }
    for (const [dir, targets] of mixedNativeLibraryDirectories) {
      if (!targets.includes(face) || !existsSync(resolve(root, dir, 'package.json'))) continue
      const manifest = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')) as Record<string, unknown>
      for (const error of mixedNativeSourceViolations(project, resolve(root, dir), manifest, './native',
        (sourceFile, specifier) => transitionAllows(dir, sourceFile, specifier, options))) errors.add(error)
    }
    for (const source of project.sourceFiles()) {
      const strictOwner = ownerOf(source.fileName, nativePackageDirectories)
      const transitionOwner = ownerOf(source.fileName, transitionalNativeSourceDirectories)
      if (strictOwner === undefined && transitionOwner === undefined) continue
      seen.add(resolve(source.fileName))
      if (strictOwner !== undefined) {
        for (const error of nativeSourceViolations(source, (specifier) => {
          const resolved = ts.resolveModuleName(specifier, source.fileName, options, ts.sys).resolvedModule
          return resolved !== undefined && ownerOf(resolved.resolvedFileName, nativePackageDirectories) !== undefined
        })) errors.add(error)
      }
      if (transitionOwner !== undefined) {
        for (const error of nativeSourceViolations(source,
          specifier => transitionAllows(transitionOwner, source.fileName, specifier, options))) errors.add(error)
      }
    }
  }
  for (const dir of new Set([...nativePackageDirectories, ...transitionalNativeSourceDirectories])) {
    const files = globSync(`${dir}/src/**/*.ts`, { cwd: root }).filter(file => !file.endsWith('.d.ts'))
    if (files.length === 0) errors.add(`${dir}: native source scan is empty`)
    for (const file of files) {
      if (!seen.has(resolve(root, file))) errors.add(`${file}: native source is absent from compiler graphs`)
    }
  }
  if (nativePackageDirectories.size === 0) errors.add('native package roster is empty')
  return [...errors]
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = collectNativeDependencyViolations(resolve(import.meta.dirname, '../..'))
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else console.log('verify-native-dependencies: strict native graph and P4 native source edges pass')
}
