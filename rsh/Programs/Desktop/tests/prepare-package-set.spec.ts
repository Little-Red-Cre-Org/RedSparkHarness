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
    vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'linux')
    vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
    vi.resetModules()
    await expect(import('../scripts/prepare-package-set.ts')).resolves.toHaveProperty('prepareDesktopPackageSet')
  })

  it('excludes only the explicit compatibility optional edges and keeps native optional packages', () => {
    const compatibilityEdges = Object.fromEntries(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
      .filter(name => name !== DESKTOP_COMPATIBILITY_HOST_PACKAGE).map(name => [name, '^1.0.0']))
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', {
        dependencies: { external: '^2.0.0', '@deepseek-ai/dsh-native-consumer': '1.0.0' },
        optionalDependencies: {
          ...compatibilityEdges,
          '@deepseek-ai/dsh-schedule': '1.0.0',
          '@deepseek-ai/dsh-session-telemetry': '1.0.0',
          '@deepseek-ai/dsh-session-telemetry-otel': '1.0.0',
          '@deepseek-ai/platform-package': '1.0.0',
          koffi: '^2.0.0',
        },
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@deepseek-ai/dsh': '^1.0.0' },
        optionalDependencies: { [DESKTOP_COMPATIBILITY_HOST_PACKAGE]: '^1.0.0' },
      })],
      [DESKTOP_COMPATIBILITY_HOST_PACKAGE, packed(DESKTOP_COMPATIBILITY_HOST_PACKAGE, {
        dependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/cordis', packed('@deepseek-ai/cordis')],
      ['@deepseek-ai/dsh-base', packed('@deepseek-ai/dsh-base', {
        dependencies: { '@deepseek-ai/dsh-tools': '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-web-app', packed('@deepseek-ai/dsh-web-app', {
        dependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-schedule', packed('@deepseek-ai/dsh-schedule', {
        peerDependencies: {
          '@deepseek-ai/cordis': '^1.0.0',
          '@deepseek-ai/dsh-agent': '^1.0.0',
          '@deepseek-ai/dsh-invariants': '^1.0.0',
          '@deepseek-ai/dsh-tools': '^1.0.0',
        },
        peerDependenciesMeta: {
          '@deepseek-ai/cordis': { optional: true },
          '@deepseek-ai/dsh-agent': { optional: true },
          '@deepseek-ai/dsh-invariants': { optional: true },
          '@deepseek-ai/dsh-tools': { optional: true },
        },
      })],
      ['@deepseek-ai/dsh-session-telemetry-otel', packed('@deepseek-ai/dsh-session-telemetry-otel', {
        peerDependencies: {
          '@deepseek-ai/cordis': '^1.0.0',
          '@deepseek-ai/dsh-session-telemetry': '^1.0.0',
        },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
      })],
      ['@deepseek-ai/dsh-session-telemetry', packed('@deepseek-ai/dsh-session-telemetry', {
        peerDependencies: {
          '@deepseek-ai/cordis': '^1.0.0',
          '@deepseek-ai/dsh-agent': '^1.0.0',
        },
        peerDependenciesMeta: {
          '@deepseek-ai/cordis': { optional: true },
          '@deepseek-ai/dsh-agent': { optional: true },
        },
      })],
      ['@deepseek-ai/dsh-agent', packed('@deepseek-ai/dsh-agent', {
        peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-invariants', packed('@deepseek-ai/dsh-invariants', {
        peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-tools', packed('@deepseek-ai/dsh-tools', {
        peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/platform-package', packed('@deepseek-ai/platform-package')],
      ['@deepseek-ai/dsh-native-consumer', packed('@deepseek-ai/dsh-native-consumer', {
        peerDependencies: { '@deepseek-ai/cordis': '^1.0.0', '@deepseek-ai/dsh-native-peer': '^1.0.0' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
      })],
      ['@deepseek-ai/dsh-native-peer', packed('@deepseek-ai/dsh-native-peer')],
      ['koffi', packed('koffi')],
    ])
    const selected = selectDesktopPackageSets(available)
    expect(selected.packages.map(entry => entry.manifest.name)).toEqual([
      '@deepseek-ai/dsh',
      DESKTOP_HOST_PACKAGE,
      '@deepseek-ai/dsh-native-consumer',
      '@deepseek-ai/dsh-native-peer',
      '@deepseek-ai/dsh-schedule',
      '@deepseek-ai/dsh-session-telemetry',
      '@deepseek-ai/dsh-session-telemetry-otel',
      '@deepseek-ai/platform-package',
      'koffi',
    ])
    expect(selected.ignoredOptionalDependencies).toEqual([...DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES].sort())
    expect(selected.packages.map(entry => entry.manifest.name)).not.toContain('@deepseek-ai/cordis')
    expect(selected.packages.map(entry => entry.manifest.name)).not.toContain('@deepseek-ai/dsh-web-app')
    expect(selected.packages.map(entry => entry.manifest.name)).not.toContain(DESKTOP_COMPATIBILITY_HOST_PACKAGE)
    const compatibility = selectDesktopPackageSets(available, 'compatibility')
    expect(compatibility.assembly).toBe('compatibility')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/cordis')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-base')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-web-app')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-schedule')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-session-telemetry')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-session-telemetry-otel')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-agent')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-invariants')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain('@deepseek-ai/dsh-tools')
    expect(compatibility.packages.map(entry => entry.manifest.name)).toContain(DESKTOP_COMPATIBILITY_HOST_PACKAGE)
    expect(compatibility.ignoredOptionalDependencies).not.toContain('@deepseek-ai/cordis')
    expect(compatibility.ignoredOptionalDependencies).not.toContain('@deepseek-ai/dsh-base')
    expect(compatibility.ignoredOptionalDependencies).not.toContain('@deepseek-ai/dsh-web-app')
  })

  it('rejects a required internal package absent from the packed release inputs', () => {
    const compatibilityEdges = Object.fromEntries(DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES
      .filter(name => name !== DESKTOP_COMPATIBILITY_HOST_PACKAGE).map(name => [name, '^1.0.0']))
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', {
        dependencies: { '@deepseek-ai/dsh-base': '^1.0.0' },
        optionalDependencies: compatibilityEdges,
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@deepseek-ai/dsh': '^1.0.0' },
        optionalDependencies: { [DESKTOP_COMPATIBILITY_HOST_PACKAGE]: '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageSets(available)).toThrow(/unpacked internal package/u)
    expect(() => selectDesktopPackageSets(new Map([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh')],
    ]))).toThrow(/omit @deepseek-ai\/dsh-desktop-host/u)
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
