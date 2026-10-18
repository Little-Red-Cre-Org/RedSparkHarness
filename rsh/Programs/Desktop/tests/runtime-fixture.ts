/** Temporary materialized packages for Desktop resource and profile behavior tests. */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_COMPATIBILITY_HOST_PACKAGE, DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES,
  DESKTOP_HOST_RUNTIME_FILES, DESKTOP_PACKAGES_DIR, DESKTOP_PACKAGE_SET_FILE } from '../src/core-package-set.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { writeDesktopRuntime, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/**
 * Write a package fixture with explicit runtime exports.
 * @param modules - Owning node_modules directory.
 * @param name - Package name.
 * @param fields - Manifest fields.
 * @param source - ESM entry contents.
 * @returns Installed package directory.
 */
export function writePackage(modules: string, name: string, fields: Record<string, unknown> = {}, source = 'export const identity = {}\n'): string {
  const path = join(modules, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.js', ...fields }))
  writeFileSync(join(path, 'index.js'), source)
  return path
}

/**
 * Seal a minimal Native release, or an explicit compatibility release, with its Host packages.
 * @param root - New runtime directory.
 * @param version - Shell and dsh version.
 * @param nodeVersion - Bundled Node version used for native rebuild selection.
 * @param includeCompatibilityHost - Include the private compatibility Host and its Cordis packages.
 * @returns Sealed runtime metadata.
 */
export function runtimeFixture(
  root: string, version = '1.0.0', nodeVersion = '24.17.0', includeCompatibilityHost = false,
): DesktopRuntimeDescriptor {
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh-client-connection',
    ...(includeCompatibilityHost ? [DESKTOP_COMPATIBILITY_HOST_PACKAGE, '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis'] : [])]
  for (const name of names) writePackage(join(root, 'node_modules'), name, { version })
  if (includeCompatibilityHost) {
    writeFileSync(join(root, 'node_modules', ...DESKTOP_COMPATIBILITY_HOST_PACKAGE.split('/'), 'package.json'),
      JSON.stringify({ name: DESKTOP_COMPATIBILITY_HOST_PACKAGE, version, private: true, type: 'module' }))
  }
  for (const file of DESKTOP_HOST_RUNTIME_FILES) {
    const path = join(root, 'node_modules', '@deepseek-ai/dsh-desktop-host', file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '')
  }
  const packageDir = join(root, DESKTOP_PACKAGES_DIR)
  mkdirSync(packageDir, { recursive: true })
  const record = (name: string, file: string) => {
    const body = Buffer.from(`${name}@${version}`)
    writeFileSync(join(packageDir, file), body)
    return { name, version, file, bytes: body.byteLength,
      integrity: `sha512-${createHash('sha512').update(body).digest('base64')}` }
  }
  const packageNames = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-desktop-host',
    ...(includeCompatibilityHost ? [DESKTOP_COMPATIBILITY_HOST_PACKAGE, '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis'] : [])]
  const packages = packageNames.map(name => record(name, `${name.split('/').at(-1)}.tgz`))
    .sort((left, right) => left.name.localeCompare(right.name))
  const selectedNames = new Set(packageNames)
  writeFileSync(join(root, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify({ schemaVersion: 2,
    assembly: includeCompatibilityHost ? 'compatibility' : 'native', packages,
    ignoredOptionalDependencies: DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES.filter(name => !selectedNames.has(name)).sort() })}\n`)
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  return writeDesktopRuntime(root, { schemaVersion: 1, version, nodeVersion, pnpmVersion: '11.7.0', hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION }, names,
    process, includeCompatibilityHost ? 'compatibility' : 'native')
}
