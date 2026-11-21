/** Desktop-owned host links recorded in each Native profile. */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { desktopRuntimeId, runtimePath, type DesktopRuntimeDescriptor } from './runtime-tree.ts'

/** Applied runtime identity and the only links Desktop may replace. */
export const DESKTOP_PROFILE_STATE = 'desktop-runtime-state.json'

/** Durable ownership of a package-directory link. */
export interface DesktopPackageLink {
  readonly name: string
  readonly target: string
}

/** Runtime identity and managed links; package preparation may still be pending. */
export interface DesktopProfileState {
  readonly schemaVersion: 1
  readonly runtimeId: string
  readonly version: string
  readonly nodeVersion: string
  readonly platform: string
  readonly arch: string
  readonly lockHash: string
  readonly links: readonly DesktopPackageLink[]
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stat(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

/**
 * Read profile state without interpreting an unpublished predecessor format.
 * @param profile - Desktop profile directory.
 * @returns Validated state, or undefined for an uninitialized profile.
 */
export function readDesktopProfileState(profile: string): DesktopProfileState | undefined {
  const path = join(profile, DESKTOP_PROFILE_STATE)
  if (!existsSync(path)) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!record(value) || value.schemaVersion !== 1 || typeof value.runtimeId !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.runtimeId) || typeof value.version !== 'string'
    || typeof value.nodeVersion !== 'string' || typeof value.platform !== 'string' || typeof value.arch !== 'string'
    || typeof value.lockHash !== 'string' || !Array.isArray(value.links)) {
    throw new Error('desktop profile: invalid runtime state')
  }
  const links = value.links.map((link: unknown): DesktopPackageLink => {
    if (!record(link) || typeof link.name !== 'string' || !PACKAGE_NAME.test(link.name)
      || typeof link.target !== 'string' || !isAbsolute(link.target)) {
      throw new Error('desktop profile: invalid managed link')
    }
    return { name: link.name, target: link.target }
  })
  if (new Set(links.map(link => link.name)).size !== links.length) throw new Error('desktop profile: duplicate managed link')
  return { schemaVersion: 1, runtimeId: value.runtimeId, version: value.version, nodeVersion: value.nodeVersion,
    platform: value.platform, arch: value.arch, lockHash: value.lockHash, links }
}

/**
 * Hash the plugin lockfile, including the empty-profile case.
 * @param profile - Desktop profile directory.
 * @returns Lockfile content identity.
 */
export function desktopPluginLockHash(profile: string): string {
  const lock = join(profile, 'pnpm-lock.yaml')
  return createHash('sha256').update(existsSync(lock) ? readFileSync(lock) : '').digest('hex')
}

/**
 * Remove only recorded host links, without following even broken targets.
 * @param profile - Desktop profile.
 */
export function unlinkDesktopHostPackages(profile: string): void {
  for (const link of readDesktopProfileState(profile)?.links ?? []) {
    const path = join(profile, 'node_modules', link.name)
    const entry = stat(path)
    if (entry === undefined) continue
    if (!entry.isSymbolicLink() || resolve(dirname(path), readlinkSync(path)) !== resolve(link.target)) {
      throw new Error(`desktop profile: refusing to replace unowned package ${link.name}`)
    }
    unlinkSync(path)
  }
}

/**
 * Bind an external profile to this application's real package directories.
 * @param profile - Candidate profile.
 * @param root - Current immutable runtime directory.
 * @param runtime - Verified release descriptor.
 */
export function linkDesktopHostPackages(profile: string, root: string, runtime: DesktopRuntimeDescriptor): void {
  unlinkDesktopHostPackages(profile)
  const links = runtime.sharedPackages.map(entry => ({ name: entry.name, target: runtimePath(root, entry.path) }))
  for (const link of links) {
    const path = join(profile, 'node_modules', link.name)
    if (stat(path) !== undefined) throw new Error(`desktop profile: plugin installed reserved host package ${link.name}`)
    mkdirSync(dirname(path), { recursive: true })
    symlinkSync(link.target, path, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const state: DesktopProfileState = { schemaVersion: 1, runtimeId: desktopRuntimeId(runtime), version: runtime.release.version,
    nodeVersion: runtime.release.nodeVersion, platform: runtime.platform, arch: runtime.arch,
    lockHash: desktopPluginLockHash(profile), links }
  writeFileSync(join(profile, DESKTOP_PROFILE_STATE), `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
}
