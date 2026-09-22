/** Native profile JSON refuses legacy ambiguity before importing plugin code. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { applyNativeProfilePatches, parseNativeProfileConfig, profileRuntime } from '../src/native-profile-config.ts'

const base = {
  formatVersion: 1,
  scopes: [{ id: 'agent', parent: 'root' }, { id: 'root' }],
  installations: [{ id: 'storage', plugin: '@deepseek-ai/dsh-fs-local', scope: 'agent', config: { cwd: 'first' } }],
}

it('resolves declared scopes and replaces complete plugin config in ordered JSON overlays', () => {
  const profile = parseNativeProfileConfig(base)
  const patched = applyNativeProfilePatches(profile, [
    { formatVersion: 1, installations: [{ id: 'storage', config: { cwd: 'second' } }] },
    { formatVersion: 1, installations: [{ id: 'storage', disabled: true }] },
  ])
  expect(patched.installations[0]).toMatchObject({ config: { cwd: 'second' }, disabled: true })
  expect(profile.installations[0]).toMatchObject({ config: { cwd: 'first' } })
})

it('rejects invalid scope graphs and installation selectors before import', () => {
  expect(() => parseNativeProfileConfig({ ...base, scopes: [{ id: 'root', parent: 'absent' }] })).toThrow('missing parent')
  expect(() => parseNativeProfileConfig({ ...base, scopes: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }] })).toThrow('cycle')
  expect(() => parseNativeProfileConfig({ ...base, scopes: [{ id: 'root' }, { id: 'root' }] })).toThrow('repeats an id')
  expect(() => parseNativeProfileConfig({ ...base, installations: [{ ...base.installations[0], plugin: './code.mjs' }] })).toThrow('package name')
  expect(() => parseNativeProfileConfig({ ...base, installations: [{ ...base.installations[0], scope: 'absent' }] })).toThrow('missing scope')
  expect(() => parseNativeProfileConfig({ ...base, executable: true })).toThrow('unknown field')
  expect(() => parseNativeProfileConfig({ ...base, formatVersion: 2 })).toThrow('formatVersion')
})

it('rejects overlays that cannot target one complete existing installation', () => {
  const profile = parseNativeProfileConfig(base)
  for (const overlay of [
    { formatVersion: 1, installations: [{ id: 'missing', config: {} }] },
    { formatVersion: 1, installations: [{ id: 'storage', disabled: true }, { id: 'storage', disabled: false }] },
    { formatVersion: 1, installations: [{ id: 'storage' }] },
    { formatVersion: 1, installations: [{ id: 'storage', disabled: 'true' }] },
    { formatVersion: 1, installations: [{ id: 'storage', config: {}, code: 'run()' }] },
  ]) expect(() => applyNativeProfilePatches(profile, [overlay])).toThrow()
})

it('selects native only with an explicit, valid profile marker', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-profile-kind-'))
  const directory = join(home, 'profiles', 'probe')
  try {
    expect(profileRuntime('probe', home)).toBe('legacy')
    await mkdir(directory, { recursive: true })
    const writeManifest = (profile: unknown) => writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'probe', dsh: { profile } }))
    await writeManifest({ bundles: [] })
    expect(profileRuntime('probe', home)).toBe('legacy')
    await writeManifest({ runtime: 'native', config: 'rsh.profile.json' })
    expect(profileRuntime('probe', home)).toBe('native')
    await writeManifest({ runtime: 'native', config: 'rsh.profile.json', bundles: [] })
    expect(() => profileRuntime('probe', home)).toThrow('cannot declare Cordis bundles')
    await writeManifest({ config: 'rsh.profile.json' })
    expect(() => profileRuntime('probe', home)).toThrow('requires runtime native')
    expect(() => profileRuntime('../probe', home)).toThrow('invalid profile name')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
