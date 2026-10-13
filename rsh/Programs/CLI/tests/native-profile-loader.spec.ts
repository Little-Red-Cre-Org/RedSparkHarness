/** Real package-export loading from a profile, including pre-import refusal. */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
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
    name, type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
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
    name, type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires, optional: [], provides } },
  }))
  const registrations = provides.map(service => `context.provide(${JSON.stringify(service)}, {})`).join(';')
  await writeFile(join(dir, 'native.mjs'), `export const plugin = { apiVersion: 1, name: ${JSON.stringify(name)}, targets: ['host'],
    requires: ${JSON.stringify(requires)}, provides: ${JSON.stringify(provides)}, resolve: () => context => { ${registrations} } }\n`)
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
    await emptyNativePackage(profileDir, 'test-child-connection', [], ['childConnection'])
    await emptyNativePackage(profileDir, 'test-child-sandbox', [], ['sandbox'])
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }, { id: 'nested', parent: 'root' }, { id: 'other' }], installations: [
        { id: 'root-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: rootProviders } },
        { id: 'other-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'other', config: { providers: unrelatedProviders } },
        { id: 'nested-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'nested', config: { providers: nestedProviders } },
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
    await emptyNativePackage(profileDir, 'test-child-connection', [], ['childConnection'])
    await emptyNativePackage(profileDir, 'test-child-sandbox', [], ['sandbox'])
    await emptyNativePackage(profileDir, 'test-remote-acp-launcher', [], ['acpChildRuntimeLauncher'])
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1,
      scopes: [{ id: 'root' }, { id: 'nested', parent: 'root' }, { id: 'other' }],
      installations: [
        { id: 'root-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: rootProviders } },
        { id: 'other-pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'other', config: { providers: unrelatedProviders } },
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
    const scopes = [{ id: 'root' }, { id: 'first', parent: 'root' }, { id: 'second', parent: 'root' }]
    const base = { formatVersion: 1, scopes, installations: [
      { id: 'pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: { route: {} } } },
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

it('runs one native application through the profile launcher and awaits disposal', async () => {
  const { home, profileDir } = await fixture()
  const packageDir = join(profileDir, 'node_modules', 'test-native-app')
  const marker = join(home, 'events.txt')
  const priorExitCode = process.exitCode
  try {
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: 'test-native-app', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['application'] } },
    }))
    await writeFile(join(packageDir, 'native.mjs'), `import { appendFileSync } from 'node:fs';
      export const plugin = { apiVersion: 1, name: 'test-native-app', targets: ['host'], requires: [], provides: ['application'],
        resolve: () => context => { context.own(() => appendFileSync(${JSON.stringify(marker)}, 'closed\\n'));
          context.provide('application', { run: async args => { appendFileSync(${JSON.stringify(marker)}, args.join(' ') + '\\n'); return 0 } }) } }
    `)
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }],
      installations: [{ id: 'app', plugin: 'test-native-app', scope: 'root' }],
    }))
    await runNativeProfile({ profile: 'probe', patchFiles: [], args: ['hello', 'native'], home })
    expect(await import('node:fs/promises').then(fs => fs.readFile(marker, 'utf8'))).toBe('hello native\nclosed\n')
  } finally {
    process.exitCode = priorExitCode
    await rm(home, { recursive: true, force: true })
  }
})
