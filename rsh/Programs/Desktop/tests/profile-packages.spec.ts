import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { afterEach, expect, it } from 'vitest'
import {
  DESKTOP_PROFILE_STATE, linkDesktopHostPackages, readDesktopProfileState, unlinkDesktopHostPackages,
} from '../src/profile-packages.ts'
import { createNativeDesktopProfile } from '../src/project-manager.ts'
import { runtimePath } from '../src/runtime-tree.ts'
import { runtimeFixture, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-profile-'))
  roots.push(root)
  const dsh = join(root, 'dsh')
  const runtime = runtimeFixture(dsh, '1.0.0', '24.17.0')
  const profile = join(root, 'profile')
  createNativeDesktopProfile(profile, join(root, '.dsh'), process.platform, {}, 'none')
  linkDesktopHostPackages(profile, dsh, runtime)
  return { root, dsh, runtime, profile }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('keeps profile build approvals explicit while allowing esbuild', () => {
  const { profile } = fixture()
  const workspace = loadYaml(readFileSync(join(profile, 'pnpm-workspace.yaml'), 'utf8')) as {
    readonly strictDepBuilds: boolean
    readonly allowBuilds: Record<string, boolean>
  }
  expect(workspace.strictDepBuilds).toBe(true)
  expect(workspace.allowBuilds).toEqual({
    esbuild: true,
    'node-pty': true,
    koffi: true,
    'fs-ext': true,
    '@redspark/rsh-subprocess-local': true,
    '@google/genai': false,
    protobufjs: false,
    'node-addon-require-builtin': false,
  })
})

it('records only the runtime shared packages as managed links', () => {
  const { dsh, runtime, profile } = fixture()
  const state = readDesktopProfileState(profile)
  expect(state?.links).toEqual(runtime.sharedPackages.map(entry => ({
    name: entry.name, target: runtimePath(dsh, entry.path),
  })))
  for (const link of state?.links ?? []) expect(existsSync(join(profile, 'node_modules', link.name))).toBe(true)
})

it('removes only recorded links and leaves an uninitialized profile alone', () => {
  const { dsh, runtime, profile } = fixture()
  unlinkDesktopHostPackages(profile)
  for (const entry of runtime.sharedPackages) {
    expect(existsSync(join(profile, 'node_modules', entry.name))).toBe(false)
  }
  linkDesktopHostPackages(profile, dsh, runtime)
  expect(readDesktopProfileState(profile)?.links.length).toBe(runtime.sharedPackages.length)
  const empty = join(profile, '..', 'empty-profile')
  mkdirSync(empty)
  expect(() => { unlinkDesktopHostPackages(empty) }).not.toThrow()
  expect(existsSync(join(empty, DESKTOP_PROFILE_STATE))).toBe(false)
})

it('removes broken owned links without following them', () => {
  const { dsh, profile } = fixture()
  rmSync(dsh, { recursive: true })
  expect(() => { unlinkDesktopHostPackages(profile) }).not.toThrow()
})

it('refuses to replace an unowned package at a managed name', () => {
  const { runtime, profile } = fixture()
  const managed = runtime.sharedPackages[0]
  if (managed === undefined) throw new Error('runtime fixture has no shared packages')
  unlinkSync(join(profile, 'node_modules', managed.name))
  writePackage(join(profile, 'node_modules'), managed.name)
  expect(() => { unlinkDesktopHostPackages(profile) }).toThrow(/unowned package/u)
})

it('refuses to link over a package a plugin installed at a reserved name', () => {
  const { dsh, runtime, profile } = fixture()
  const managed = runtime.sharedPackages[0]
  if (managed === undefined) throw new Error('runtime fixture has no shared packages')
  unlinkDesktopHostPackages(profile)
  rmSync(join(profile, DESKTOP_PROFILE_STATE))
  writePackage(join(profile, 'node_modules'), managed.name)
  expect(() => { linkDesktopHostPackages(profile, dsh, runtime) }).toThrow(/reserved host package/u)
})

it('rejects managed links recorded outside the profile node_modules', () => {
  const { profile } = fixture()
  const path = join(profile, DESKTOP_PROFILE_STATE)
  const state = JSON.parse(readFileSync(path, 'utf8')) as { links: Array<{ target: string }> }
  state.links[0]!.target = 'relative'
  writeFileSync(path, JSON.stringify(state))
  expect(() => readDesktopProfileState(profile)).toThrow(/invalid managed link/u)
})

it('rejects a duplicate managed link record', () => {
  const { profile } = fixture()
  const path = join(profile, DESKTOP_PROFILE_STATE)
  const state = JSON.parse(readFileSync(path, 'utf8')) as { links: Array<{ name: string; target: string }> }
  state.links.push({ name: state.links[0]!.name, target: state.links[0]!.target })
  writeFileSync(path, JSON.stringify(state))
  expect(() => readDesktopProfileState(profile)).toThrow(/duplicate managed link/u)
})

it('refuses a symlink that points somewhere other than the recorded target', () => {
  const { dsh, runtime, profile } = fixture()
  const managed = runtime.sharedPackages[0]
  if (managed === undefined) throw new Error('runtime fixture has no shared packages')
  const path = join(profile, 'node_modules', managed.name)
  unlinkSync(path)
  symlinkSync(dsh, path, process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => { unlinkDesktopHostPackages(profile) }).toThrow(/unowned package/u)
})
