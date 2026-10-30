/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly root: string
  readonly profile: string
  readonly lock: string
  readonly pnpm: {
    readonly root: string
    readonly store: string
    readonly cache: string
    readonly state: string
    readonly config: string
    readonly home: string
  }
}

/**
 * The directory Electron keeps its own state in: cookies, Local Storage,
 * caches, GPU and crash records.
 *
 * It is set explicitly rather than inherited from the packaged manifest. The
 * Electron default is `app.getName()`, and the packaged manifest carries the
 * upstream package name with no `productName`, so the default would resolve to
 * the upstream product's directory and two installations would share one
 * profile. electron-builder's `productName` does not reach `app.getName()`: it
 * names the produced artifact and is never written back into the asar.
 * Electron refuses to override a `userData` that has already been read, so the
 * caller must apply this before the first `app` path access.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @returns absolute user-data directory under the Harness home.
 */
export function desktopUserDataPath(dshHome: string = resolveDshHome()): string {
  return join(dshHome, 'desktop', 'user-data')
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = resolveDshHome()): DesktopPaths {
  const root = join(dshHome, 'desktop')
  const pnpm = join(root, 'pnpm')
  return {
    root,
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
    pnpm: {
      root: pnpm,
      store: join(pnpm, 'store'),
      cache: join(pnpm, 'cache'),
      state: join(pnpm, 'state'),
      config: join(pnpm, 'config'),
      home: join(pnpm, 'home'),
    },
  }
}
