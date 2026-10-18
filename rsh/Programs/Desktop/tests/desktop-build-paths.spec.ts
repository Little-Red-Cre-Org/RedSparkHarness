import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopTargetBuildPaths,
  resolveDesktopBuildAssembly,
  resolveDesktopBuildTarget,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('isolates every mutable build directory by complete target', () => {
    const arm64 = desktopTargetBuildPaths('mac-arm64')
    const x64 = desktopTargetBuildPaths('mac-x64')
    const windows = desktopTargetBuildPaths('win-x64')
    const compatibility = desktopTargetBuildPaths('win-x64', 'compatibility')
    const mutableKeys = [
      'root',
      'artifacts',
      'runtime',
      'packageSet',
      'dsh',
      'dshPnpm',
      'nodeExtract',
      'packedDsh',
      'packedVendor',
      'packedLandlock',
    ] as const

    for (const key of mutableKeys) {
      expect(new Set([arm64[key], x64[key], windows[key]]).size).toBe(3)
    }
    expect(arm64.artifacts).toContain(join('targets', 'mac-arm64', 'artifacts'))
    expect(x64.dsh).toContain(join('targets', 'mac-x64', 'dsh'))
    expect(windows.runtime).toContain(join('targets', 'win-x64', 'runtime'))
    expect(compatibility.assembly).toBe('compatibility')
    expect(compatibility.dsh).toContain(join('targets', 'win-x64', 'compatibility', 'dsh'))
    expect(compatibility.dsh).not.toBe(windows.dsh)
  })

  it('shares only the immutable upstream download cache', () => {
    const arm64 = desktopTargetBuildPaths('mac-arm64')
    const x64 = desktopTargetBuildPaths('mac-x64')
    expect(arm64.downloads).toBe(x64.downloads)
    expect(arm64.downloads).not.toContain(`${sep}targets${sep}`)
  })

  it('resolves environment overrides and rejects unsupported targets', () => {
    expect(resolveDesktopBuildTarget({
      DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
    }, 'darwin', 'arm64')).toBe('mac-x64')
    expect(resolveDesktopBuildTarget({}, 'win32', 'x64')).toBe('win-x64')
    expect(resolveDesktopBuildAssembly({})).toBe('native')
    expect(resolveDesktopBuildAssembly({ DSH_DESKTOP_ASSEMBLY: 'compatibility' })).toBe('compatibility')
    expect(() => resolveDesktopBuildAssembly({ DSH_DESKTOP_ASSEMBLY: 'unknown' })).toThrow(/unsupported assembly/u)
    expect(() => resolveDesktopBuildTarget({}, 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => desktopTargetBuildPaths('linux-x64' as 'mac-x64')).toThrow(/unsupported target/u)
  })
})
