import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDesktopCompatibilityHostPackageFiles,
  assertDesktopHostPackageFiles,
  selectDesktopPackageSets,
  type PackedDesktopPackage,
} from '../scripts/prepare-package-set.ts'
import {
  DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES,
  DESKTOP_COMPATIBILITY_HOST_PACKAGE,
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
} from '../src/core-package-set.ts'

function packed(name: string, manifest: Record<string, unknown> = {}): PackedDesktopPackage {
  return { tarball: `${name}.tgz`, manifest: { name, version: '1.0.0', ...manifest } }
}

describe('desktop package-set selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not select a packaging target when imported as a library', async () => {
    vi.stubEnv('RSH_DESKTOP_TARGET_PLATFORM', 'linux')
    vi.stubEnv('RSH_DESKTOP_TARGET_ARCH', 'x64')
    vi.resetModules()
    await expect(import('../scripts/prepare-package-set.ts')).resolves.toHaveProperty('prepareDesktopPackageSet')
  })

  it('excludes only the explicit compatibility optional edges and keeps native optional packages', () => {
    const compatibilityEdges = Object.fromEntries(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
      .filter(name => name !== DESKTOP_COMPATIBILITY_HOST_PACKAGE).map(name => [name, '^1.0.0']))
    const available = new Map<string, PackedDesktopPackage>([
      ['@redspark/rsh', packed('@redspark/rsh', {
        dependencies: { external: '^2.0.0', '@redspark/rsh-native-consumer': '1.0.0' },
        optionalDependencies: {
          ...compatibilityEdges,
          '@redspark/rsh-schedule': '1.0.0',
          '@redspark/rsh-session-telemetry': '1.0.0',
          '@redspark/rsh-session-telemetry-otel': '1.0.0',
          '@redspark/platform-package': '1.0.0',
          koffi: '^2.0.0',
        },
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@redspark/rsh': '^1.0.0' },
        optionalDependencies: { [DESKTOP_COMPATIBILITY_HOST_PACKAGE]: '^1.0.0' },
      })],
      [DESKTOP_COMPATIBILITY_HOST_PACKAGE, packed(DESKTOP_COMPATIBILITY_HOST_PACKAGE, {
        dependencies: { '@redspark/cordis': '^1.0.0' },
      })],
      ['@redspark/cordis', packed('@redspark/cordis')],
      ['@redspark/rsh-base', packed('@redspark/rsh-base', {
        dependencies: { '@redspark/rsh-tools': '^1.0.0' },
      })],
      ['@redspark/rsh-web-app', packed('@redspark/rsh-web-app', {
        dependencies: { '@redspark/cordis': '^1.0.0' },
      })],
      ['@redspark/rsh-schedule', packed('@redspark/rsh-schedule', {
        peerDependencies: {
          '@redspark/cordis': '^1.0.0',
          '@redspark/rsh-agent': '^1.0.0',
          '@redspark/rsh-invariants': '^1.0.0',
          '@redspark/rsh-tools': '^1.0.0',
        },
        peerDependenciesMeta: {
          '@redspark/cordis': { optional: true },
          '@redspark/rsh-agent': { optional: true },
          '@redspark/rsh-invariants': { optional: true },
          '@redspark/rsh-tools': { optional: true },
        },
      })],
      ['@redspark/rsh-session-telemetry-otel', packed('@redspark/rsh-session-telemetry-otel', {
        peerDependencies: {
          '@redspark/cordis': '^1.0.0',
          '@redspark/rsh-session-telemetry': '^1.0.0',
        },
        peerDependenciesMeta: { '@redspark/cordis': { optional: true } },
      })],
      ['@redspark/rsh-session-telemetry', packed('@redspark/rsh-session-telemetry', {
        peerDependencies: {
          '@redspark/cordis': '^1.0.0',
          '@redspark/rsh-agent': '^1.0.0',
        },
        peerDependenciesMeta: {
          '@redspark/cordis': { optional: true },
          '@redspark/rsh-agent': { optional: true },
        },
      })],
      ['@redspark/rsh-agent', packed('@redspark/rsh-agent', {
        peerDependencies: { '@redspark/cordis': '^1.0.0' },
      })],
      ['@redspark/rsh-invariants', packed('@redspark/rsh-invariants', {
        peerDependencies: { '@redspark/cordis': '^1.0.0' },
      })],
      ['@redspark/rsh-tools', packed('@redspark/rsh-tools', {
        peerDependencies: { '@redspark/cordis': '^1.0.0' },
      })],
      ['@redspark/platform-package', packed('@redspark/platform-package')],
      ['@redspark/rsh-native-consumer', packed('@redspark/rsh-native-consumer', {
        peerDependencies: { '@redspark/cordis': '^1.0.0', '@redspark/rsh-native-peer': '^1.0.0' },
        peerDependenciesMeta: { '@redspark/cordis': { optional: true } },
      })],
      ['@redspark/rsh-native-peer', packed('@redspark/rsh-native-peer')],
      ['koffi', packed('koffi')],
    ])
    const selected = selectDesktopPackageSets(available)
    expect(selected.packages.map(entry => entry.manifest.name)).toEqual([
      '@redspark/rsh',
      DESKTOP_HOST_PACKAGE,
      '@redspark/rsh-native-consumer',
      '@redspark/rsh-native-peer',
      '@redspark/rsh-schedule',
      '@redspark/rsh-session-telemetry',
      '@redspark/rsh-session-telemetry-otel',
      '@redspark/platform-package',
      'koffi',
    ])
    expect(selected.ignoredOptionalDependencies).toEqual([...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort())
    expect(selected.packages.map(entry => entry.manifest.name)).not.toContain('@redspark/cordis')
    expect(selected.packages.map(entry => entry.manifest.name)).not.toContain('@redspark/rsh-web-app')
    expect(selected.packages.map(entry => entry.manifest.name)).not.toContain(DESKTOP_COMPATIBILITY_HOST_PACKAGE)
    const compatibility = selectDesktopPackageSets(available, 'compatibility')
    expect(compatibility.assembly).toBe('compatibility')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/cordis')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-base')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-web-app')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-schedule')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-session-telemetry')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-session-telemetry-otel')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-agent')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-invariants')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-tools')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain(DESKTOP_COMPATIBILITY_HOST_PACKAGE)
    expect(compatibility.ignoredOptionalDependencies).not.toContain('@redspark/cordis')
    expect(compatibility.ignoredOptionalDependencies).not.toContain('@redspark/rsh-base')
    expect(compatibility.ignoredOptionalDependencies).not.toContain('@redspark/rsh-web-app')
  })

  it('rejects a required internal package absent from the packed release inputs', () => {
    const compatibilityEdges = Object.fromEntries(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
      .filter(name => name !== DESKTOP_COMPATIBILITY_HOST_PACKAGE).map(name => [name, '^1.0.0']))
    const available = new Map<string, PackedDesktopPackage>([
      ['@redspark/rsh', packed('@redspark/rsh', {
        dependencies: { '@redspark/rsh-native-missing': '^1.0.0' },
        optionalDependencies: compatibilityEdges,
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@redspark/rsh': '^1.0.0' },
        optionalDependencies: { [DESKTOP_COMPATIBILITY_HOST_PACKAGE]: '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageSets(available)).toThrow(/unpacked internal package/u)
    expect(() => selectDesktopPackageSets(new Map([
      ['@redspark/rsh', packed('@redspark/rsh')],
    ]))).toThrow(/omit @redspark\/dsh-desktop-host/u)
  })

  it('does not follow a non-optional peer into a compatibility-only package', () => {
    const compatibilityEdges = Object.fromEntries(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
      .filter(name => name !== DESKTOP_COMPATIBILITY_HOST_PACKAGE).map(name => [name, '^1.0.0']))
    const available = new Map<string, PackedDesktopPackage>([
      ['@redspark/rsh', packed('@redspark/rsh', {
        dependencies: { '@redspark/rsh-native-consumer': '1.0.0' },
        optionalDependencies: compatibilityEdges,
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@redspark/rsh': '^1.0.0' },
        optionalDependencies: { [DESKTOP_COMPATIBILITY_HOST_PACKAGE]: '^1.0.0' },
      })],
      [DESKTOP_COMPATIBILITY_HOST_PACKAGE, packed(DESKTOP_COMPATIBILITY_HOST_PACKAGE)],
      ['@redspark/rsh-native-consumer', packed('@redspark/rsh-native-consumer', {
        peerDependencies: { '@redspark/rsh-system-prompt': '^1.0.0' },
      })],
      ['@redspark/rsh-system-prompt', packed('@redspark/rsh-system-prompt', {
        peerDependencies: {
          '@redspark/rsh-invariants': '^1.0.0',
          '@redspark/rsh-native-peer': '^1.0.0',
        },
      })],
      ['@redspark/rsh-invariants', packed('@redspark/rsh-invariants')],
      ['@redspark/rsh-native-peer', packed('@redspark/rsh-native-peer')],
    ])
    const selected = selectDesktopPackageSets(available)
    expect(selected.packages.map(entry => entry.manifest.name)).toEqual([
      '@redspark/rsh',
      DESKTOP_HOST_PACKAGE,
      '@redspark/rsh-native-consumer',
      '@redspark/rsh-native-peer',
      '@redspark/rsh-system-prompt',
    ])
    const compatibility = selectDesktopPackageSets(available, 'compatibility')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@redspark/rsh-invariants')
  })

  it('rejects a hard dependency on a compatibility-only package', () => {
    const compatibilityEdges = Object.fromEntries(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
      .filter(name => name !== DESKTOP_COMPATIBILITY_HOST_PACKAGE).map(name => [name, '^1.0.0']))
    const available = new Map<string, PackedDesktopPackage>([
      ['@redspark/rsh', packed('@redspark/rsh', {
        dependencies: { '@redspark/rsh-native-consumer': '1.0.0' },
        optionalDependencies: compatibilityEdges,
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@redspark/rsh': '^1.0.0' },
        optionalDependencies: { [DESKTOP_COMPATIBILITY_HOST_PACKAGE]: '^1.0.0' },
      })],
      ['@redspark/rsh-native-consumer', packed('@redspark/rsh-native-consumer', {
        dependencies: { '@redspark/rsh-invariants': '^1.0.0' },
      })],
      ['@redspark/rsh-invariants', packed('@redspark/rsh-invariants')],
    ])
    expect(() => selectDesktopPackageSets(available)).toThrow(
      '@redspark/rsh-native-consumer requires compatibility-only package @redspark/rsh-invariants',
    )
  })

  it('requires the Native Host entry files in the default package set', () => {
    expect(() => { assertDesktopHostPackageFiles(DESKTOP_HOST_RUNTIME_FILES.map(file => `package/${file}`)) }).not.toThrow()
    expect(() => { assertDesktopHostPackageFiles(['package/lib/index.js']) }).toThrow(/lib\/native-host\.js/u)
    expect(() => { assertDesktopCompatibilityHostPackageFiles([
      'package/lib/index.js', 'package/config/desktop.cordis.patch.yml',
    ]) }).not.toThrow()
    expect(() => { assertDesktopCompatibilityHostPackageFiles(['package/lib/index.js']) })
      .toThrow(/config\/desktop\.cordis\.patch\.yml/u)
  })

})
