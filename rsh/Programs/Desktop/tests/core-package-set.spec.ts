import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  DESKTOP_COMPATIBILITY_HOST_PACKAGE,
  DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES,
  desktopCorePackageOverrides,
  desktopDshPackageSpec,
  parseDesktopCorePackageSet,
  verifyDesktopCoreLockfile,
  verifyDesktopCorePackageSet,
  type DesktopCorePackageRecord,
} from '../src/core-package-set.ts'

const roots: string[] = []

function record(name: string, file: string, body: Buffer, version = '1.2.3'): DesktopCorePackageRecord {
  return {
    name,
    version,
    file,
    bytes: body.byteLength,
    integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
  }
}

function packageSetProject(): {
  root: string
  dsh: DesktopCorePackageRecord
  base: DesktopCorePackageRecord
  host: DesktopCorePackageRecord
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-package-set-'))
  roots.push(root)
  const packageDir = join(root, DESKTOP_PACKAGES_DIR)
  mkdirSync(packageDir)
  const dshBody = Buffer.from('dsh')
  const baseBody = Buffer.from('base')
  const hostBody = Buffer.from('host')
  const dsh = record('@deepseek-ai/dsh', 'dsh.tgz', dshBody)
  const base = record('@deepseek-ai/dsh-base', 'dsh-base.tgz', baseBody)
  const host = record('@deepseek-ai/dsh-desktop-host', 'dsh-desktop-host.tgz', hostBody)
  writeFileSync(join(packageDir, dsh.file), dshBody)
  writeFileSync(join(packageDir, host.file), hostBody)
  writeFileSync(join(root, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify({
    schemaVersion: 2, assembly: 'native',
    packages: [dsh, host],
    ignoredOptionalDependencies: [...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort(),
  })}\n`)
  return { root, dsh, base, host }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop core package set', () => {
  it('pins the direct dsh dependency and every internal package to local tarballs', () => {
    const { root, dsh, base, host } = packageSetProject()
    const packageSet = verifyDesktopCorePackageSet(root, '1.2.3')
    expect(desktopDshPackageSpec(packageSet)).toBe('file:./desktop-packages/dsh.tgz')
    expect(desktopCorePackageOverrides(packageSet)).toEqual({
      '@deepseek-ai/dsh': 'file:./desktop-packages/dsh.tgz',
      '@deepseek-ai/dsh-desktop-host': 'file:./desktop-packages/dsh-desktop-host.tgz',
    })
    expect(packageSet.ignoredOptionalDependencies).toEqual([...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort())
    const compatibilityHost = record(DESKTOP_COMPATIBILITY_HOST_PACKAGE, 'compat-host.tgz', Buffer.from('compat'))
    const cordis = record('@deepseek-ai/cordis', 'cordis.tgz', Buffer.from('cordis'))
    const compatibilityPackages = [dsh, base, host, compatibilityHost, cordis]
      .sort((left, right) => left.name.localeCompare(right.name))
    const compatibility = parseDesktopCorePackageSet({ schemaVersion: 2, assembly: 'compatibility',
      packages: compatibilityPackages,
      ignoredOptionalDependencies: DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
        .filter(name => !compatibilityPackages.some(entry => entry.name === name)).sort() }, '1.2.3')
    expect(compatibility.assembly).toBe('compatibility')
    expect(compatibility.packages.map(entry => entry.name)).toContain(DESKTOP_COMPATIBILITY_HOST_PACKAGE)
    expect(compatibility.ignoredOptionalDependencies).not.toContain('@deepseek-ai/cordis')
  })

  it('rejects version drift, descriptor disorder, corruption, and extra files', () => {
    const { root, dsh, base, host } = packageSetProject()
    expect(() => verifyDesktopCorePackageSet(root, '2.0.0')).toThrow(/does not match Desktop/u)
    expect(() => parseDesktopCorePackageSet({ schemaVersion: 2, assembly: 'native', packages: [dsh, base, host],
      ignoredOptionalDependencies: [...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort() }))
      .toThrow(/Native assembly contains a compatibility-only package/u)
    expect(() => parseDesktopCorePackageSet({
      schemaVersion: 2, assembly: 'native',
      packages: [dsh, { ...host, version: '2.0.0' }],
      ignoredOptionalDependencies: [...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort(),
    }, '1.2.3')).toThrow(/dsh-desktop-host@2\.0\.0 does not match Desktop 1\.2\.3/u)
    expect(() => parseDesktopCorePackageSet({
      schemaVersion: 2, assembly: 'native', packages: [base, dsh, host],
      ignoredOptionalDependencies: [...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort(),
    }))
      .toThrow(/sorted by name/u)
    writeFileSync(join(root, DESKTOP_PACKAGES_DIR, dsh.file), 'changed')
    expect(() => verifyDesktopCorePackageSet(root, '1.2.3')).toThrow(/integrity check failed/u)
    writeFileSync(join(root, DESKTOP_PACKAGES_DIR, 'extra.tgz'), '')
    expect(() => verifyDesktopCorePackageSet(root, '1.2.3')).toThrow(/does not match its descriptor/u)
  })

  it('rejects registry resolutions for names supplied by the local package set', () => {
    const dsh = record('@deepseek-ai/dsh', 'dsh.tgz', Buffer.from('dsh'))
    const host = record('@deepseek-ai/dsh-desktop-host', 'host.tgz', Buffer.from('host'))
    const packageSet = parseDesktopCorePackageSet({ schemaVersion: 2, assembly: 'native', packages: [dsh, host],
      ignoredOptionalDependencies: [...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort() })
    expect(() => {
      verifyDesktopCoreLockfile(
        "packages:\n  '@deepseek-ai/dsh@file:desktop-packages/dsh.tgz':\n    resolution: {}\n",
        packageSet,
      )
    }).not.toThrow()
    expect(() => {
      verifyDesktopCoreLockfile(
        "packages:\n  '@deepseek-ai/dsh@1.2.3':\n    resolution: {integrity: sha512-registry}\n",
        packageSet,
      )
    }).toThrow(/outside the local package set/u)
    // A compatibility-only edge may still resolve from the registry, because the Native
    // assembly deliberately omits it. The Cordis kernel is no longer such an edge: the bridge
    // ships it locally, so naming it here would be a package-set omission.
    expect(() => {
      verifyDesktopCoreLockfile(
        "packages:\n  '@deepseek-ai/dsh-app-boot@1.0.0':\n    resolution: {integrity: sha512-registry}\n",
        packageSet,
      )
    }).toThrow(/ignored compatibility optional @deepseek-ai\/dsh-app-boot/u)
  })

})
