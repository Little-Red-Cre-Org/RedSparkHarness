/** Real package-export loading from a profile, including pre-import refusal. */
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { NativeScope, type NativePlugin, type NativePluginInventory } from '@deepseek-ai/dsh-native-runtime'
import { loadNativeProfile, replaceNativeProfile } from '../src/native-profile-loader.ts'
import { runNativeProfile } from '../src/native-profile-boot.ts'

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-profile-load-'))
  const app = join(home, 'app')
  const profileDir = join(home, 'profiles', 'probe')
  await mkdir(app)
  await mkdir(join(profileDir, 'node_modules'), { recursive: true })
  const installAnchor = join(app, 'package.json')
  await writeFile(installAnchor, JSON.stringify({ name: 'test-app', type: 'module' }))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'probe', private: true, dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  return { home, profileDir, installAnchor }
}

async function packageEntry(profileDir: string, name: string, marker: string, valid = true): Promise<void> {
  const dir = join(profileDir, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name, version: '1.0.0', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: valid ? './native' : './missing', targets: ['host'], requires: [], optional: [], provides: ['fs'] } },
  }))
  await writeFile(join(dir, 'native.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); export const plugin = { apiVersion: 1, name: ${JSON.stringify(name)}, targets: ['host'], requires: [], provides: ['fs'], resolve: () => context => context.provide('fs', { read: () => 1 }) }\n`)
}

async function emptyNativePackage(
  profileDir: string, name: string, requires: readonly string[], provides: readonly string[],
): Promise<void> {
  const dir = join(profileDir, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name, version: '1.0.0', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires, optional: [], provides } },
  }))
  const registrations = provides.map(service => `context.provide(${JSON.stringify(service)}, {})`).join(';')
  await writeFile(join(dir, 'native.mjs'), `export const plugin = { apiVersion: 1, name: ${JSON.stringify(name)}, targets: ['host'],
    requires: ${JSON.stringify(requires)}, provides: ${JSON.stringify(provides)}, resolve: () => context => { ${registrations} } }\n`)
}

async function inventoryPackage(profileDir: string, packageName: string, pluginName: string): Promise<void> {
  const dir = join(profileDir, 'node_modules', packageName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: packageName, version: '1.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: [] } },
  }))
  await writeFile(join(dir, 'native.mjs'), `export const plugin = { apiVersion: 1, name: ${JSON.stringify(pluginName)},
    targets: ['host'], requires: [], provides: [], resolve: config => context => { if (config?.fail) throw new Error('replacement activation failed') } }\n`)
}

async function childPackages(profileDir: string, kind: 'sdk' | 'acp'): Promise<void> {
  await emptyNativePackage(profileDir, kind === 'sdk' ? '@deepseek-ai/dsh-sdk-child' : '@deepseek-ai/dsh-acp-child',
    [kind === 'sdk' ? 'sdkChildRuntimeLauncher' : 'acpChildRuntimeLauncher'], ['externalSubagentDriver'])
  await emptyNativePackage(profileDir, '@deepseek-ai/dsh-subprocess-local', [], ['childConnection'])
  await emptyNativePackage(profileDir, '@deepseek-ai/dsh-sandbox-local', [], ['sandbox'])
}

it('inherits the nearest visible pi-ai provider catalog into the opt-in SDK child profile', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  try {
    const rootProviders = { route: { baseURL: 'https://root.invalid/v1' } }
    const nestedProviders = { route: { baseURL: 'https://nested.invalid/v1' } }
    const unrelatedProviders = { route: { baseURL: 'https://unrelated.invalid/v1' } }
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-llm-pi-ai', [], ['model'])
    await childPackages(profileDir, 'sdk')
    await emptyNativePackage(profileDir, 'test-credentials', [], ['credentials'])
    await emptyNativePackage(profileDir, 'test-child-connection', [], ['childConnection'])
    await emptyNativePackage(profileDir, 'test-child-sandbox', [], ['sandbox'])
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }, { id: 'nested', parent: 'root' }, { id: 'other' }], installations: [
        { id: 'root-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: rootProviders } },
        { id: 'other-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'other', config: { providers: unrelatedProviders } },
        { id: 'nested-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'nested', config: { providers: nestedProviders } },
        { id: 'credentials', plugin: 'test-credentials', scope: 'root' },
        { id: 'child-connection', plugin: 'test-child-connection', scope: 'nested' },
        { id: 'child-sandbox', plugin: 'test-child-sandbox', scope: 'nested' },
        { id: 'dsh-sdk-child', plugin: '@deepseek-ai/dsh-sdk-child', scope: 'nested', config: { providerName: 'dsh-sdk' } },
      ],
    }))
    const loaded = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home })
    expect(loaded.profile.installations.find(row => row.id === 'dsh-sdk-child')?.config)
      .toEqual({ providerName: 'dsh-sdk', providers: nestedProviders })
    const diagnostics = loaded.host.diagnostics()
    const launcher = diagnostics.find(row => row.name === '@deepseek-ai/dsh-sdk-child-runtime-launcher')
    const child = diagnostics.find(row => row.name === '@deepseek-ai/dsh-sdk-child')
    const names = new Map(diagnostics.map(row => [row.id, row.name]))
    expect(launcher?.scope).toBe(child?.scope)
    expect(launcher?.dependencies.map(item => [item.service, names.get(item.provider)])).toEqual([
      ['childConnection', 'test-child-connection'], ['sandbox', 'test-child-sandbox'],
    ])
    expect(loaded.profile.installations.some(row => row.id.startsWith('native-child-runtime/'))).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('uses the nearest visible model Provider catalog and process Providers for ACP children', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const rootProviders = { route: { baseURL: 'https://root.invalid/v1' } }
  const nestedProviders = { route: { baseURL: 'https://nested.invalid/v1' } }
  const unrelatedProviders = { route: { baseURL: 'https://unrelated.invalid/v1' } }
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-llm-pi-ai', [], ['model'])
    await childPackages(profileDir, 'acp')
    await emptyNativePackage(profileDir, 'test-credentials', [], ['credentials'])
    await emptyNativePackage(profileDir, 'test-child-connection', [], ['childConnection'])
    await emptyNativePackage(profileDir, 'test-child-sandbox', [], ['sandbox'])
    await emptyNativePackage(profileDir, 'test-remote-acp-launcher', [], ['acpChildRuntimeLauncher'])
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1,
      scopes: [{ id: 'root' }, { id: 'nested', parent: 'root' }, { id: 'other' }],
      installations: [
        { id: 'root-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: rootProviders } },
        { id: 'credentials', plugin: 'test-credentials', scope: 'root' },
        { id: 'other-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'other', config: { providers: unrelatedProviders } },
        { id: 'other-credentials', plugin: 'test-credentials', scope: 'other' },
        { id: 'nested-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'nested', config: { providers: nestedProviders } },
        { id: 'child-connection', plugin: 'test-child-connection', scope: 'nested' },
        { id: 'child-sandbox', plugin: 'test-child-sandbox', scope: 'nested' },
        { id: 'remote-acp-launcher', plugin: 'test-remote-acp-launcher', scope: 'other' },
        { id: 'disabled-child-connection', plugin: '@deepseek-ai/dsh-subprocess-local', scope: 'other', disabled: true },
        { id: 'disabled-child-sandbox', plugin: '@deepseek-ai/dsh-sandbox-local', scope: 'other', disabled: true },
        { id: 'acp-child', plugin: '@deepseek-ai/dsh-acp-child', scope: 'nested', config: { providerName: 'dsh-acp-child' } },
        { id: 'acp-child-other', plugin: '@deepseek-ai/dsh-acp-child', scope: 'other', config: { providerName: 'dsh-acp-child' } },
      ],
    }))
    const desktopCarrier = { apiVersion: 1, name: 'test-desktop-carrier', targets: ['host'] as const,
      requires: [] as const, provides: [] as const, resolve: () => () => {} }
    const loaded = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home,
      carrier: { plugin: desktopCarrier, scope: 'root' } })

    expect(loaded.profile.installations.find(row => row.id === 'acp-child')?.config)
      .toEqual({ providerName: 'dsh-acp-child', providers: nestedProviders })
    expect(loaded.profile.installations.find(row => row.id === 'acp-child-other')?.config)
      .toEqual({ providerName: 'dsh-acp-child', providers: unrelatedProviders })
    const diagnostics = loaded.host.diagnostics()
    const launchers = diagnostics.filter(row => row.name === '@deepseek-ai/dsh-acp-child-runtime-launcher')
    const children = diagnostics.filter(row => row.name === '@deepseek-ai/dsh-acp-child')
    const remoteLauncher = diagnostics.find(row => row.name === 'test-remote-acp-launcher')
    expect(launchers.map(row => row.scope)).toEqual([children[0]?.scope])
    expect(remoteLauncher?.scope).toBe(children[1]?.scope)
    const names = new Map(diagnostics.map(row => [row.id, row.name]))
    expect(launchers.map(row => row.dependencies.map(item => [item.service, names.get(item.provider)]))).toEqual([
      [['childConnection', 'test-child-connection'], ['sandbox', 'test-child-sandbox']],
    ])
    const launcher = launchers[0]
    expect(launcher?.dependencies.map(item => [item.service, names.get(item.provider)])).toEqual([
      ['childConnection', 'test-child-connection'], ['sandbox', 'test-child-sandbox'],
    ])
    expect(loaded.profile.installations.some(row => row.id.startsWith('native-child-runtime/'))).toBe(false)
    expect(diagnostics.some(row => row.name === 'test-desktop-carrier')).toBe(true)

    await emptyNativePackage(profileDir, 'test-model-provider', [], ['model'])
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1,
      scopes: [{ id: 'root' }, { id: 'nested', parent: 'root' }],
      installations: [
        { id: 'root-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: rootProviders } },
        { id: 'nested-model', plugin: 'test-model-provider', scope: 'nested' },
        { id: 'acp-child', plugin: '@deepseek-ai/dsh-acp-child', scope: 'nested', config: { providerName: 'dsh-acp-child' } },
      ],
    }))
    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow('cannot inherit route config from model Provider test-model-provider')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it.each([
  { kind: 'SDK', packageKind: 'sdk' as const, package: '@deepseek-ai/dsh-sdk-child', name: '@deepseek-ai/dsh-sdk-child-runtime-launcher', providerName: 'dsh-sdk' },
  { kind: 'ACP', packageKind: 'acp' as const, package: '@deepseek-ai/dsh-acp-child', name: '@deepseek-ai/dsh-acp-child-runtime-launcher', providerName: 'dsh-acp-child' },
])('rebuilds scoped $kind child runtime contributions for every profile candidate', async ({ packageKind, package: childPackage, name: launcherName, providerName }) => {
  const { home, profileDir, installAnchor } = await fixture()
  const profilePath = join(profileDir, 'rsh.profile.json')
  const desktopCarrier = { apiVersion: 1, name: 'test-desktop-carrier', targets: ['host'] as const,
    requires: [] as const, provides: [] as const, resolve: () => () => {} }
  const options = { profile: 'probe', patchFiles: [], target: 'host' as const, installAnchor, home,
    carrier: { plugin: desktopCarrier, scope: 'root' } }
  let active: Awaited<ReturnType<typeof loadNativeProfile>> | undefined
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-llm-pi-ai', [], ['model'])
    await childPackages(profileDir, packageKind)
    await emptyNativePackage(profileDir, 'test-credentials', [], ['credentials'])
    const scopes = [{ id: 'root' }, { id: 'first', parent: 'root' }, { id: 'second', parent: 'root' }]
    const base = { formatVersion: 1, scopes, installations: [
      { id: 'pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: { route: {} } } },
      { id: 'credentials', plugin: 'test-credentials', scope: 'root' },
    ] }
    await writeFile(profilePath, JSON.stringify(base))
    const initial = await loadNativeProfile(options)
    await initial.host.start()
    active = initial
    expect(active.host.diagnostics().some(row => row.name === launcherName)).toBe(false)

    const withChild = { ...base, installations: [...base.installations,
      { id: 'child', plugin: childPackage, scope: 'first', config: { providerName } }] }
    await writeFile(profilePath, JSON.stringify(withChild))
    const added = await loadNativeProfile({ ...options, previous: active })
    active = await replaceNativeProfile(initial.host, added)
    const addedDiagnostics = active.host.diagnostics().filter(row => row.state === 'ready')
    const addedLauncher = addedDiagnostics.find(row => row.name === launcherName)
    const addedChild = addedDiagnostics.find(row => row.name === childPackage)
    expect(addedLauncher?.scope).toBe(addedChild?.scope)
    const addedNames = new Map(addedDiagnostics.map(row => [row.id, row.name]))
    expect(addedLauncher?.dependencies.map(item => addedNames.get(item.provider)))
      .toEqual(['@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-sandbox-local'])
    expect(added.profile.installations.filter(row => row.id.startsWith('native-child-runtime/')).map(row => row.id))
      .toEqual(['native-child-runtime/first/subprocess', 'native-child-runtime/first/sandbox'])
    expect(added.host.diagnostics().some(row => row.name === 'test-desktop-carrier')).toBe(true)

    const moved = { ...withChild, installations: withChild.installations.map(row => row.id === 'child' ? { ...row, scope: 'second' } : row) }
    await writeFile(profilePath, JSON.stringify(moved))
    const relocated = await loadNativeProfile({ ...options, previous: active })
    active = await replaceNativeProfile(initial.host, relocated)
    const relocatedDiagnostics = active.host.diagnostics().filter(row => row.state === 'ready')
    const relocatedLauncher = relocatedDiagnostics.find(row => row.name === launcherName)
    const relocatedChild = relocatedDiagnostics.find(row => row.name === childPackage)
    expect(relocatedLauncher?.scope).toBe(relocatedChild?.scope)
    const relocatedNames = new Map(relocatedDiagnostics.map(row => [row.id, row.name]))
    expect(relocatedLauncher?.dependencies.map(item => relocatedNames.get(item.provider)))
      .toEqual(['@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-sandbox-local'])
    expect(relocated.profile.installations.filter(row => row.id.startsWith('native-child-runtime/')).map(row => row.id))
      .toEqual(['native-child-runtime/second/subprocess', 'native-child-runtime/second/sandbox'])
    expect(relocated.host.diagnostics().some(row => row.name === 'test-desktop-carrier')).toBe(true)

    await writeFile(profilePath, JSON.stringify(base))
    const removed = await loadNativeProfile({ ...options, previous: active })
    active = await replaceNativeProfile(initial.host, removed)
    const retired = active.host.diagnostics().filter(row => row.name === launcherName
      || row.name === '@deepseek-ai/dsh-subprocess-local' || row.name === '@deepseek-ai/dsh-sandbox-local')
    expect(retired).toHaveLength(6)
    expect(retired.every(row => row.state === 'disposed')).toBe(true)
    expect(removed.host.diagnostics().some(row => row.name === launcherName
      || row.name === '@deepseek-ai/dsh-subprocess-local' || row.name === '@deepseek-ai/dsh-sandbox-local')).toBe(false)
    expect(active.host.diagnostics().some(row => row.name === 'test-desktop-carrier')).toBe(true)
  } finally {
    await active?.host.stop()
    await rm(home, { recursive: true, force: true })
  }
})

it('loads a named package export through a native profile and owns its lifecycle', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const marker = join(home, 'loaded.txt')
  try {
    await packageEntry(profileDir, 'test-native-provider', marker)
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }],
      installations: [{ id: 'provider', plugin: 'test-native-provider', scope: 'root' }],
    }))
    const loaded = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home })
    expect(existsSync(marker)).toBe(true)
    expect(loaded.host.diagnostics()[0]?.state).toBe('planned')
    await loaded.host.start()
    expect(loaded.host.diagnostics()[0]?.state).toBe('ready')
    await loaded.host.stop()
    expect(loaded.host.diagnostics()[0]?.state).toBe('disposed')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('registers ready user native preset folders under child scopes and lists their summaries', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const directory = join(home, '.agent-presets', 'operator')
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-presets', [], ['agentPresets'])
    await emptyNativePackage(profileDir, 'test-native-tools', [], [])
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-preset-standing', ['agentPresets'], [])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'preset.yml'), 'name: Operator\ndescription: User tools.\n')
    await writeFile(join(directory, 'agent.native.json'), JSON.stringify({ formatVersion: 1, installations: [
      { id: 'tools', plugin: 'test-native-tools', config: { enabled: true } },
    ] }))
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }],
      installations: [{ id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root', config: { default: 'operator' } }],
    }))

    const loaded = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home })

    expect(loaded.profile.scopes).toContainEqual({ id: 'preset:operator', parent: 'root' })
    expect(loaded.profile.installations).toContainEqual({ id: 'preset:operator/tools', plugin: 'test-native-tools',
      config: { enabled: true }, scope: 'preset:operator' })
    expect(loaded.profile.installations).toContainEqual({ id: 'preset:operator', plugin: '@deepseek-ai/dsh-agent-preset-standing',
      scope: 'preset:operator', config: { id: 'operator', name: 'Operator', description: 'User tools.' } })
    expect(loaded.requests.has('preset:operator')).toBe(true)
    const presetConfig = loaded.profile.installations.find(row => row.id === 'agent-presets')?.config as {
      readonly default: string
      readonly folders: readonly unknown[]
      readonly managementRoots: readonly { readonly path: string; readonly trust: 'system' | 'user' }[]
    }
    expect(presetConfig.default).toBe('operator')
    expect(presetConfig.folders).toContainEqual(expect.objectContaining({ id: 'operator', trust: 'user', status: 'ready' }))
    expect(presetConfig.managementRoots).toContainEqual({ path: join(home, '.agent-presets'), trust: 'user' })
  } finally { await rm(home, { recursive: true, force: true }) }
})

it.each(['preset:operator/tools', 'preset:operator'])('rejects native preset install id %s when it collides with the profile', async (collisionId) => {
  const { home, profileDir, installAnchor } = await fixture()
  const directory = join(home, '.agent-presets', 'operator')
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-presets', [], ['agentPresets'])
    await emptyNativePackage(profileDir, 'test-native-tools', [], [])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'preset.yml'), 'name: Operator\n')
    await writeFile(join(directory, 'agent.native.json'), JSON.stringify({ formatVersion: 1, installations: [
      { id: 'tools', plugin: 'test-native-tools' },
    ] }))
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }], installations: [
        { id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root' },
        { id: collisionId, plugin: 'test-native-tools', scope: 'root' },
      ],
    }))

    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow(`dsh: preset operator install id ${collisionId} collides with an existing profile installation`)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('rejects a preset folder whose scope is declared without registering that preset', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const directory = join(home, '.agent-presets', 'operator')
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-presets', [], ['agentPresets'])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'preset.yml'), 'name: Operator\n')
    await writeFile(join(directory, 'agent.native.json'), JSON.stringify({ formatVersion: 1, installations: [] }))
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }, { id: 'preset:operator', parent: 'root' }],
      installations: [{ id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root' }],
    }))

    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow('dsh: profile already declares scope preset:operator but does not register preset operator')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('rejects every static manifest before importing any selected plugin', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const marker = join(home, 'premature-import.txt')
  try {
    await packageEntry(profileDir, 'test-first', marker)
    await packageEntry(profileDir, 'test-invalid', join(home, 'invalid-import.txt'), false)
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }], installations: [
        { id: 'first', plugin: 'test-first', scope: 'root' },
        { id: 'invalid', plugin: 'test-invalid', scope: 'root' },
      ],
    }))
    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow('invalid package test-invalid')
    expect(existsSync(marker)).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('refuses a legacy patch on an explicitly native profile', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  try {
    await writeFile(join(profileDir, 'cordis.patch.yml'), '- id: old-provider\n  disabled: true\n')
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [], installations: [] }))
    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow('cannot apply Cordis patch')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('installs the launch proxy before running a native application and awaits disposal', async () => {
  const { home, profileDir } = await fixture()
  const packageDir = join(profileDir, 'node_modules', 'test-native-app')
  const marker = join(home, 'events.txt')
  const priorExitCode = process.exitCode
  const proxyNames = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'DSH_HOME', 'CORDIS_SHARED']
  const priorEnvironment = new Map(proxyNames.map(name => [name, process.env[name]]))
  let proxyRequest: string | undefined
  const proxy = createServer((request, response) => {
    proxyRequest = String(request.url)
    response.end('PROXIED')
  })
  try {
    proxy.listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    const address = proxy.address()
    if (address === null || typeof address === 'string') throw new Error('test proxy did not bind a TCP port')
    for (const name of proxyNames) Reflect.deleteProperty(process.env, name)
    process.env.DSH_HOME = home
    process.env.HTTP_PROXY = `http://127.0.0.1:${address.port}`
    process.env.HTTPS_PROXY = process.env.HTTP_PROXY
    process.env.NO_PROXY = ''
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: 'test-native-app', version: '1.0.0', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['application'] } },
    }))
    await writeFile(join(packageDir, 'native.mjs'), `import { appendFileSync } from 'node:fs';
      export const plugin = { apiVersion: 1, name: 'test-native-app', targets: ['host'], requires: [], provides: ['application'],
        resolve: () => context => { context.own(() => appendFileSync(${JSON.stringify(marker)}, 'closed\\n'));
          context.provide('application', { run: async args => { appendFileSync(${JSON.stringify(marker)}, args.join(' ') + '\\n');
            const response = await fetch('http://native-proxy-check.invalid/path');
            appendFileSync(${JSON.stringify(marker)}, await response.text() + '\\n'); return 0 } }) } }
    `)
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }],
      installations: [{ id: 'app', plugin: 'test-native-app', scope: 'root' }],
    }))
    await runNativeProfile({ profile: 'probe', patchFiles: [], args: ['hello', 'native'], home })
    expect(proxyRequest).toBe('http://native-proxy-check.invalid/path')
    expect(await readFile(marker, 'utf8')).toBe('hello native\nPROXIED\nclosed\n')
  } finally {
    process.exitCode = priorExitCode
    for (const [name, value] of priorEnvironment) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
    if (proxy.listening) {
      await new Promise<void>((resolve, reject) => {
        proxy.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }
    await rm(home, { recursive: true, force: true })
  }
})

it('projects exact ready package provenance through dynamic scope ancestry and excludes failed replacements', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const profilePath = join(profileDir, 'rsh.profile.json')
  let inventory: NativePluginInventory | undefined
  const reader: NativePlugin = {
    apiVersion: 1, name: 'test-inventory-reader', targets: ['host'], requires: ['pluginInventory'], provides: [],
    resolve: () => (context) => { inventory = context.require('pluginInventory') },
  }
  let active: Awaited<ReturnType<typeof loadNativeProfile>> | undefined
  try {
    await inventoryPackage(profileDir, 'test-root-manifest', 'native-root-plugin')
    await inventoryPackage(profileDir, 'test-first-manifest', 'native-first-plugin')
    await inventoryPackage(profileDir, 'test-second-manifest', 'native-second-plugin')
    const base = {
      formatVersion: 1,
      scopes: [{ id: 'root' }, { id: 'first', parent: 'root' }, { id: 'second', parent: 'root' }],
      installations: [
        { id: 'root-id', plugin: 'test-root-manifest', scope: 'root' },
        { id: 'first-id', plugin: 'test-first-manifest', scope: 'first' },
        { id: 'second-id', plugin: 'test-second-manifest', scope: 'second' },
        { id: 'disabled-id', plugin: 'missing-disabled-package', scope: 'second', disabled: true },
      ],
    }
    await writeFile(profilePath, JSON.stringify(base))
    const initial = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home,
      carrier: { plugin: reader, scope: 'root' } })
    await initial.host.start()
    active = initial
    if (inventory === undefined) throw new Error('inventory reader did not activate')
    const root = initial.requests.get('root-id')?.scope
    const first = initial.requests.get('first-id')?.scope
    const second = initial.requests.get('second-id')?.scope
    if (root === undefined || first === undefined || second === undefined) throw new Error('missing fixture scope')
    const dynamicFirst = new NativeScope(first)
    const firstRows = inventory.packages(dynamicFirst)
    expect(firstRows.map(row => [row.package.name, row.package.version])).toEqual([
      ['test-root-manifest', '1.0.0'], ['test-first-manifest', '1.0.0'],
    ])
    const initialFirstId = firstRows.find(row => row.package.name === 'test-first-manifest')?.id
    const initialRootId = firstRows.find(row => row.package.name === 'test-root-manifest')?.id
    const initialSecondRows = inventory.packages(second)
    const initialSecondId = initialSecondRows.find(row => row.package.name === 'test-second-manifest')?.id
    if (initialFirstId === undefined || initialRootId === undefined || initialSecondId === undefined) {
      throw new Error('missing fixture installation identity')
    }
    expect(firstRows.map(row => row.id)).toEqual([
      initial.host.diagnostics().find(row => row.name === 'native-root-plugin')?.id,
      initial.host.diagnostics().find(row => row.name === 'native-first-plugin')?.id,
    ])
    expect(inventory.packages(second).map(row => row.package.name)).toEqual([
      'test-root-manifest', 'test-second-manifest',
    ])
    expect(firstRows.some(row => row.package.name === 'missing-disabled-package')).toBe(false)

    const replacementDir = join(profileDir, 'node_modules', 'test-first-manifest')
    const manifestPath = join(replacementDir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string }
    manifest.version = '2.0.0'
    await writeFile(manifestPath, JSON.stringify(manifest))
    const updated = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home,
      previous: active, carrier: { plugin: reader, scope: 'root' } })
    active = await replaceNativeProfile(initial.host, updated)
    const updatedFirstRows = inventory.packages(dynamicFirst)
    expect(updatedFirstRows.map(row => [row.package.name, row.package.version])).toEqual([
      ['test-root-manifest', '1.0.0'], ['test-first-manifest', '2.0.0'],
    ])
    expect(updatedFirstRows.find(row => row.package.name === 'test-root-manifest')?.id).toBe(initialRootId)
    expect(updatedFirstRows.find(row => row.package.name === 'test-first-manifest')?.id).not.toBe(initialFirstId)
    expect(inventory.packages(second).find(row => row.package.name === 'test-second-manifest')?.id).toBe(initialSecondId)

    const firstPackage = JSON.parse(await readFile(manifestPath, 'utf8')) as { name: string; version: string }
    await writeFile(manifestPath, JSON.stringify({ ...firstPackage, name: '' }))
    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home,
      previous: active, carrier: { plugin: reader, scope: 'root' } }))
      .rejects.toThrow('native installation first-id: invalid package test-first-manifest')
    await writeFile(manifestPath, JSON.stringify(firstPackage))
    const secondManifestPath = join(profileDir, 'node_modules', 'test-second-manifest', 'package.json')
    const secondPackage = JSON.parse(await readFile(secondManifestPath, 'utf8')) as { name: string; version: string }
    await writeFile(secondManifestPath, JSON.stringify({ ...secondPackage, version: '' }))
    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home,
      previous: active, carrier: { plugin: reader, scope: 'root' } }))
      .rejects.toThrow('native installation second-id: invalid package test-second-manifest')
    await writeFile(secondManifestPath, JSON.stringify(secondPackage))

    const failed = { ...base, installations: base.installations.map(row => row.id === 'first-id'
      ? { ...row, config: { fail: true } } : row) }
    await writeFile(profilePath, JSON.stringify(failed))
    const candidate = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home,
      previous: active, carrier: { plugin: reader, scope: 'root' } })
    await expect(replaceNativeProfile(initial.host, candidate)).rejects.toThrow('replacement activation failed')
    expect(inventory.list().some(row => row.state === 'planned')).toBe(false)
    expect(inventory.packages(dynamicFirst)).toEqual([])
  } finally {
    const errors: unknown[] = []
    try { await active?.host.stop() }
    catch (error) { errors.push(error) }
    try { await rm(home, { recursive: true, force: true }) }
    catch (error) { errors.push(error) }
    if (errors.length > 0) throw new AggregateError(errors, 'native inventory fixture cleanup failed')
  }
})
