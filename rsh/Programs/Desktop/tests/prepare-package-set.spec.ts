import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDesktopHostPackageFiles,
  selectDesktopPackageSets,
  type PackedDesktopPackage,
} from '../scripts/prepare-package-set.ts'
import { DESKTOP_HOST_PACKAGE, DESKTOP_HOST_RUNTIME_FILES } from '../src/core-package-set.ts'

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

  it('selects the complete Native closure including optional packages and peers', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@redspark/rsh', packed('@redspark/rsh', {
        dependencies: { external: '^2.0.0', '@redspark/rsh-native-consumer': '1.0.0' },
        optionalDependencies: {
          '@redspark/rsh-schedule': '1.0.0',
          '@redspark/rsh-session-telemetry': '1.0.0',
          '@redspark/platform-package': '1.0.0',
          koffi: '^2.0.0',
        },
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@redspark/rsh': '^1.0.0' },
      })],
      ['@redspark/rsh-schedule', packed('@redspark/rsh-schedule', {
        peerDependencies: {
          '@redspark/rsh-agent': '^1.0.0',
          '@redspark/rsh-invariants': '^1.0.0',
        },
      })],
      ['@redspark/rsh-agent', packed('@redspark/rsh-agent')],
      ['@redspark/rsh-invariants', packed('@redspark/rsh-invariants')],
      ['@redspark/platform-package', packed('@redspark/platform-package')],
      ['@redspark/rsh-native-consumer', packed('@redspark/rsh-native-consumer', {
        peerDependencies: { '@redspark/rsh-native-peer': '^1.0.0' },
      })],
      ['@redspark/rsh-native-peer', packed('@redspark/rsh-native-peer')],
      ['koffi', packed('koffi')],
    ])
    const selected = selectDesktopPackageSets(available)
    expect(selected.assembly).toBe('native')
    expect(selected.packages.map(entry => entry.manifest.name)).toEqual([
      '@redspark/platform-package',
      '@redspark/rsh',
      '@redspark/rsh-agent',
      DESKTOP_HOST_PACKAGE,
      '@redspark/rsh-invariants',
      '@redspark/rsh-native-consumer',
      '@redspark/rsh-native-peer',
      '@redspark/rsh-schedule',
      'koffi',
    ])
    expect(selected.ignoredOptionalDependencies).toEqual([])
  })

  it('does not follow an optional package or optional peer absent from the packed inputs', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@redspark/rsh', packed('@redspark/rsh', {
        dependencies: { '@redspark/rsh-native-consumer': '1.0.0' },
        optionalDependencies: { '@google/genai': '^1.0.0' },
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@redspark/rsh': '^1.0.0' },
      })],
      ['@redspark/rsh-native-consumer', packed('@redspark/rsh-native-consumer', {
        peerDependencies: { '@redspark/rsh-system-prompt': '^1.0.0' },
        peerDependenciesMeta: { '@redspark/rsh-system-prompt': { optional: true } },
      })],
    ])
    const selected = selectDesktopPackageSets(available)
    expect(selected.packages.map(entry => entry.manifest.name)).toEqual([
      '@redspark/rsh',
      DESKTOP_HOST_PACKAGE,
      '@redspark/rsh-native-consumer',
    ])
  })

  it('rejects a required internal package absent from the packed release inputs', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@redspark/rsh', packed('@redspark/rsh', {
        dependencies: { '@redspark/rsh-native-missing': '^1.0.0' },
      })],
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE, {
        dependencies: { '@redspark/rsh': '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageSets(available)).toThrow(/unpacked internal package/u)
    expect(() => selectDesktopPackageSets(new Map([
      ['@redspark/rsh', packed('@redspark/rsh')],
    ]))).toThrow(/omit @redspark\/rsh-desktop-host/u)
    expect(() => selectDesktopPackageSets(new Map([
      [DESKTOP_HOST_PACKAGE, packed(DESKTOP_HOST_PACKAGE)],
    ]))).toThrow(/omit @redspark\/rsh/u)
  })

  it('requires the Native Host entry files in the selected closure', () => {
    expect(() => { assertDesktopHostPackageFiles(DESKTOP_HOST_RUNTIME_FILES.map(file => `package/${file}`)) }).not.toThrow()
    expect(() => { assertDesktopHostPackageFiles(['package/lib/index.js']) }).toThrow(/lib\/native-host\.js/u)
  })
})
