/** Validate native source imports, type references, augmentations and manifest dependencies. */
import { globSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { parseNativeEntryManifest } from '../Core/runtime-diagnostics/native-runtime/src/manifest.ts'
import { nativePackageDirectories } from './native-package-policy.ts'
import { TypeScriptProject } from './ts-project.ts'

/**
 * Inspect module references, including type-only edges and computed loading.
 * @param source - parsed production source.
 * @param resolveAllowed - resolves aliases and package subpaths to an admitted source owner.
 * @returns violations with their source offsets.
 */
export function nativeSourceViolations(source: ts.SourceFile, resolveAllowed: (specifier: string) => boolean): string[] {
  const errors: string[] = []
  const check = (node: ts.Node, argument: ts.Node | undefined): void => {
    if (argument === undefined || (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument))) {
      errors.push(`${source.fileName}:${node.getStart(source)}: native source cannot compute a module target`)
    } else if (!resolveAllowed(argument.text)) {
      errors.push(`${source.fileName}:${node.getStart(source)}: native source cannot reference ${argument.text}`)
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

/**
 * Check both compiler graphs and reject missing production source coverage.
 * @param root - workspace root with face aggregates and package manifests.
 * @returns all forbidden edges and undiscovered source files.
 */
export function collectNativeDependencyViolations(root: string): string[] {
  const errors = new Set<string>()
  const seen = new Set<string>()
  const ownerOf = (file: string): string | undefined => {
    const path = relative(root, file).replaceAll('\\', '/')
    return [...nativePackageDirectories].find(dir => path.startsWith(`${dir}/src/`))
  }
  const names = new Set<string>()
  for (const file of globSync('rsh/**/package.json', { cwd: root })) {
    const manifest = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as Record<string, unknown>
    const dsh = manifest.dsh
    if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh) || !Object.hasOwn(dsh, 'native')) continue
    try {
      const entry = (dsh as Record<string, unknown>).native
      const exports = manifest.exports
      const names = exports !== null && typeof exports === 'object' && !Array.isArray(exports)
        ? new Set(Object.keys(exports)) : new Set<string>()
      parseNativeEntryManifest(entry, names)
    } catch (error) {
      errors.add(`${file}: ${error instanceof Error ? error.message : 'invalid native manifest'}`)
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
    for (const source of project.sourceFiles()) {
      if (ownerOf(source.fileName) === undefined) continue
      seen.add(resolve(source.fileName))
      for (const error of nativeSourceViolations(source, (specifier) => {
        const resolved = ts.resolveModuleName(specifier, source.fileName, options, ts.sys).resolvedModule
        return resolved !== undefined && ownerOf(resolved.resolvedFileName) !== undefined
      })) errors.add(error)
    }
  }
  for (const dir of nativePackageDirectories) {
    const files = globSync(`${dir}/src/**/*.ts`, { cwd: root })
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
  } else console.log('verify-native-dependencies: native production graph has no external framework dependencies')
}
