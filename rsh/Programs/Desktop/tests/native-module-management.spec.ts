/** Native Desktop profile inventory, package operations, and lifecycle outcomes. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from '../src/project-manager.ts'
import type { NativeDesktopInstallationId } from '../src/native-module-management.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { expandNativeProfilePresets, readNativeProfile } from '@deepseek-ai/dsh/native-profile'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-desktop-'))
  roots.push(root)
  return root
}

function writeNativePackage(profile: string, name: string, targets: readonly ('host' | 'client')[],
  requires: readonly string[], provides: readonly string[], version = '1.0.0', optional: readonly string[] = [],
  sourcePrefix = ''): void {
  const directory = join(profile, 'node_modules', ...name.split('/'))
  mkdirSync(directory, { recursive: true })
  const entry = { apiVersion: 1, entry: './native', targets, requires, optional, provides }
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, type: 'module',
    exports: { './native': './native.js' }, dsh: { native: entry } }))
  writeFileSync(join(directory, 'native.js'), `${sourcePrefix}export const plugin = ${JSON.stringify({ apiVersion: 1, name,
    targets, requires, optional, provides })}; plugin.resolve = () => () => {}\n`)
}

interface NativeRow {
  readonly id: string
  readonly plugin: string
  readonly scope?: string
  readonly config?: unknown
  readonly disabled?: boolean
}

function writeNativeProfile(profile: string, rows: readonly NativeRow[], clientRows: readonly NativeRow[]): void {
  const packages = [...new Set([...rows, ...clientRows].map(row => row.plugin))]
  const dependencies = Object.fromEntries(packages.map(name => [name, '1.0.0']))
  const lockDependencies = Object.fromEntries(packages.map(name => [name, { specifier: '1.0.0', version: '1.0.0' }]))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-runtime', private: true,
    version: '0.0.0', dependencies, dsh: { profile: { runtime: 'native', config: 'rsh.profile.json', configReload: 'startup' } } }))
  writeFileSync(join(profile, 'pnpm-lock.yaml'), JSON.stringify({ lockfileVersion: '9.0', importers: { '.': { dependencies: lockDependencies } } }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1,
    scopes: [{ id: 'root' }, { id: 'empty', parent: 'root' }],
    installations: rows.map(row => ({ ...row, scope: row.scope ?? 'root' })) }))
  writeFileSync(join(profile, 'rsh.client.json'), JSON.stringify({ formatVersion: 1, installations: clientRows }))
}

const initialHostRows: readonly NativeRow[] = [
  { id: 'credentials', plugin: '@fixture/credentials' },
  { id: 'native-session', plugin: '@fixture/native-session' },
  { id: 'host-update', plugin: '@fixture/host-update' },
  { id: 'optional-host', plugin: '@fixture/optional', scope: 'empty', config: { token: 'private-host-value' } },
  { id: 'already-disabled', plugin: '@fixture/optional', disabled: true, config: { keep: [1, 2] } },
]
const initialClientRows: readonly NativeRow[] = [
  { id: 'client-state', plugin: '@fixture/client-state' },
  { id: 'client-app', plugin: '@fixture/client-app' },
  { id: 'client-renderer', plugin: '@fixture/client-renderer' },
  { id: 'optional-client', plugin: '@fixture/optional', config: 'private-client-value' },
  { id: 'client-already-disabled', plugin: '@fixture/optional', disabled: true, config: null },
]

function prepareFixture(root: string): { manager: DesktopProjectManager; profile: string } {
  const runtime = join(root, 'resources', 'dsh')
  runtimeFixture(runtime)
  const paths = resolveDesktopPaths(join(root, '.dsh'))
  const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeNativePnpm(root), dsh: runtime })
  return { manager, profile: paths.profile }
}

function prepareNativePackages(profile: string): void {
  writeNativePackage(profile, '@fixture/credentials', ['host'], ['launchEnvironment'], ['credentials'])
  writeNativePackage(profile, '@fixture/native-session', ['host'], ['credentials', 'hostConnection', 'pluginInventory'], ['nativeWebSession'])
  writeNativePackage(profile, '@fixture/host-update', ['host'], [], [])
  writeNativePackage(profile, '@fixture/optional', ['host', 'client'], [], [])
  writeNativePackage(profile, '@fixture/client-state', ['client'], [], ['clientState'])
  writeNativePackage(profile, '@fixture/client-app', ['client'], ['clientState'], ['clientApplication'])
  writeNativePackage(profile, '@fixture/client-renderer', ['client'], [], ['clientRenderer'], '1.0.0', [],
    'void document.createElement("div")\n')
}

function writeNativePnpm(root: string): string {
  const script = join(root, 'native-pnpm.mjs')
  const log = join(root, 'native-pnpm.jsonl')
  writeFileSync(script, `
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const command = args.find(value => ['add', 'remove', 'rebuild'].includes(value))
const project = process.cwd()
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n')
if (command === 'add' || command === 'remove') {
  const manifestPath = join(project, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const value = args[args.indexOf(command) + 1]
  const separator = value.lastIndexOf('@')
  const name = command === 'add' && separator > 0 ? value.slice(0, separator) : value
  if (command === 'add') {
    const version = separator > 0 ? value.slice(separator + 1) : '1.0.0'
    manifest.dependencies[name] = version
    const directory = join(project, 'node_modules', ...name.split('/'))
    mkdirSync(directory, { recursive: true })
    const manifestFile = join(directory, 'package.json')
    const targets = name === '@fixture/unsupported-client' ? ['legacy'] : ['client']
    let created = false
    let installed = { name, version, type: 'module', exports: { './native': './native.js' },
      dsh: { native: { apiVersion: 1, entry: './native', targets, requires: [], optional: [], provides: [] } } }
    try { installed = { ...installed, ...JSON.parse(readFileSync(manifestFile, 'utf8')), version } } catch { created = true }
    if (name === '@fixture/host-update' && version === '1.1.0') {
      installed.dsh.native.requires = ['credentials']
      const entry = installed.dsh.native
      const plugin = { apiVersion: 1, name, targets: entry.targets, requires: entry.requires,
        optional: entry.optional, provides: entry.provides }
      writeFileSync(join(directory, 'native.js'), 'export const plugin = ' + JSON.stringify(plugin)
        + '; plugin.resolve = () => () => {}\\n')
    }
    writeFileSync(manifestFile, JSON.stringify(installed))
    if (created) writeFileSync(join(directory, 'native.js'), 'export const plugin = { apiVersion: 1, name: ' + JSON.stringify(name)
      + ', targets: ' + JSON.stringify(targets) + ', requires: [], provides: [], resolve: () => () => {} }\\n')
  } else {
    delete manifest.dependencies[name]
    rmSync(join(project, 'node_modules', ...name.split('/')), { recursive: true, force: true })
  }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const dependencies = Object.fromEntries(Object.entries(manifest.dependencies).map(([packageName, version]) => [packageName,
    { specifier: version, version }]))
  writeFileSync(join(project, 'pnpm-lock.yaml'), JSON.stringify({ lockfileVersion: '9.0', importers: { '.': { dependencies } } }))
}
`)
  return script
}

function writeCurrentProfile(manager: DesktopProjectManager, profile: string): void {
  writeNativeProfile(profile, initialHostRows, initialClientRows)
  prepareNativePackages(profile)
}

function configurePresetFixture(manager: DesktopProjectManager, profile: string, sessionRequiresAgentPresets: boolean): void {
  writeNativeProfile(profile, [...initialHostRows,
    { id: 'preset-manager', plugin: '@deepseek-ai/dsh-agent-presets' },
    { id: 'preset-root-provider', plugin: '@fixture/preset-root-provider' },
  ], initialClientRows)
  prepareNativePackages(profile)
  writeNativePackage(profile, '@fixture/native-session', ['host'], [
    'credentials', 'hostConnection', 'pluginInventory', ...(sessionRequiresAgentPresets ? ['agentPresets'] : []),
  ], ['nativeWebSession'])
  writeNativePackage(profile, '@deepseek-ai/dsh-agent-presets', ['host'], [], ['agentPresets'])
  writeNativePackage(profile, '@deepseek-ai/dsh-agent-preset-standing', ['host'], [], [])
  writeNativePackage(profile, '@fixture/preset-root-provider', ['host'], [], ['presetRequirement'])
  writeNativePackage(profile, '@fixture/preset-consumer', ['host'], ['presetRequirement'], [])
  const consumerManifestPath = join(profile, 'node_modules', '@fixture', 'preset-consumer', 'package.json')
  const consumerManifest = readJson(consumerManifestPath)
  const consumerExports = consumerManifest.exports as Record<string, string>
  consumerExports['./package.json'] = './package.json'
  writeFileSync(consumerManifestPath, JSON.stringify(consumerManifest))
  const presetManifest = readJson(join(profile, 'package.json'))
  const presetDependencies = presetManifest.dependencies as Record<string, string>
  presetDependencies['@deepseek-ai/dsh-agent-preset-standing'] = '1.0.0'
  presetDependencies['@fixture/preset-consumer'] = '1.0.0'
  writeFileSync(join(profile, 'package.json'), JSON.stringify(presetManifest))
  const presetLock = readJson(join(profile, 'pnpm-lock.yaml'))
  const lockImporter = (presetLock.importers as Record<string, { dependencies: Record<string, unknown> }>)['.']
  lockImporter.dependencies['@deepseek-ai/dsh-agent-preset-standing'] = { specifier: '1.0.0', version: '1.0.0' }
  lockImporter.dependencies['@fixture/preset-consumer'] = { specifier: '1.0.0', version: '1.0.0' }
  writeFileSync(join(profile, 'pnpm-lock.yaml'), JSON.stringify(presetLock))
  const presetDir = join(dirname(manager.paths.root), '.agent-presets', 'review-local')
  mkdirSync(presetDir, { recursive: true })
  writeFileSync(join(presetDir, 'agent.native.json'), JSON.stringify({ formatVersion: 1,
    installations: [{ id: 'consumer', plugin: '@fixture/preset-consumer' }] }))
}

function hooks(counter: { stop: number; start: number }): DesktopProjectHooks {
  return { beforeChange: async () => { counter.stop += 1 }, afterChange: async () => { counter.start += 1 } }
}

function ready() { return { phase: 'ready' as const } }

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('lists all scopes and disables only rows outside the Host and Client boot closure', async () => {
  const root = fixtureRoot()
  const { manager, profile } = prepareFixture(root)
  await manager.applyRelease()
  writeCurrentProfile(manager, profile)
  const lifecycle = { stop: 0, start: 0 }
  const listed = await manager.listNativeModules(ready)
  expect(listed.status).toBe('listed')
  if (listed.status !== 'listed') return
  expect(listed.inventory.scopes.map(scope => scope.id)).toEqual(['root', 'empty'])
  expect(JSON.stringify(listed.inventory)).not.toContain('private-host-value')
  expect(JSON.stringify(listed.inventory)).not.toContain('private-client-value')
  const applied = await manager.mutateNativeModules({ type: 'disable-all', request: { expectedRevision: listed.inventory.revision } },
    hooks(lifecycle), ready)
  expect(applied.status).toBe('applied')
  const host = readJson(join(profile, 'rsh.profile.json')) as { installations: NativeRow[] }
  const client = readJson(join(profile, 'rsh.client.json')) as { installations: NativeRow[] }
  expect(host.installations.filter(row => row.disabled !== true).map(row => row.id)).toEqual(['credentials', 'native-session'])
  expect(host.installations.find(row => row.id === 'optional-host')).toMatchObject({ disabled: true, config: { token: 'private-host-value' } })
  expect(host.installations.find(row => row.id === 'already-disabled')).toMatchObject({ ...initialHostRows[4], scope: 'root' })
  expect(client.installations.filter(row => row.disabled !== true).map(row => row.id))
    .toEqual(['client-state', 'client-app', 'client-renderer'])
  expect(client.installations.find(row => row.id === 'optional-client')).toMatchObject({ disabled: true, config: 'private-client-value' })
  expect(client.installations.find(row => row.id === 'client-already-disabled')).toEqual(initialClientRows[4])
  expect(lifecycle).toEqual({ stop: 1, start: 1 })
  const after = await manager.listNativeModules(ready)
  expect(after.status).toBe('listed')
  if (after.status !== 'listed') return
  const noOp = await manager.mutateNativeModules({ type: 'disable-all', request: { expectedRevision: after.inventory.revision } },
    hooks(lifecycle), ready)
  expect(noOp).toMatchObject({ status: 'applied', revision: after.inventory.revision })
  const stale = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: listed.inventory.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('optional-client') }, enabled: true,
  } }, hooks(lifecycle), ready)
  expect(stale).toMatchObject({ status: 'refused', error: {
    code: 'stale-revision', messageKey: 'nativeStaleRevision', currentRevision: after.inventory.revision,
  } })
  const required = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: after.inventory.revision,
    key: { target: 'host', id: brandString<NativeDesktopInstallationId>('native-session') }, enabled: false,
  } }, hooks(lifecycle), ready)
  expect(required).toMatchObject({ status: 'refused', error: {
    code: 'dependency-conflict', blockedBy: [{ target: 'host', id: 'native-session' }],
  } })
  writeFileSync(manager.paths.lock, String(process.pid))
  try {
    expect(await manager.listNativeModules(ready)).toMatchObject({ status: 'refused', error: { code: 'busy' } })
  } finally {
    if (existsSync(manager.paths.lock)) rmSync(manager.paths.lock)
  }
  expect(lifecycle).toEqual({ stop: 1, start: 1 })

  writeNativeProfile(profile, [...initialHostRows,
    { id: 'duplicate-inventory', plugin: '@fixture/inventory-duplicate' }], initialClientRows)
  prepareNativePackages(profile)
  writeNativePackage(profile, '@fixture/inventory-duplicate', ['host'], [], ['pluginInventory'])
  expect(await manager.listNativeModules(ready)).toMatchObject({
    status: 'refused', error: { code: 'profile-invalid' },
  })

  const cycleRoot = fixtureRoot()
  const cycleFixture = prepareFixture(cycleRoot)
  await cycleFixture.manager.applyRelease()
  writeNativeProfile(cycleFixture.profile, initialHostRows, [...initialClientRows,
    { id: 'cycle-provider', plugin: '@fixture/client-cycle', disabled: true }])
  prepareNativePackages(cycleFixture.profile)
  writeNativePackage(cycleFixture.profile, '@fixture/client-app', ['client'], ['clientState'],
    ['clientApplication', 'cycleApp'], '1.0.0', ['cycleRenderer'])
  writeNativePackage(cycleFixture.profile, '@fixture/client-cycle', ['client'], [], ['cycleRenderer'],
    '1.0.0', ['cycleApp'])
  const cycleInventory = await cycleFixture.manager.listNativeModules(ready)
  expect(cycleInventory.status).toBe('listed')
  if (cycleInventory.status !== 'listed') return
  const cyclePackage = cycleInventory.inventory.packages.find(row => row.packageName === '@fixture/client-cycle')
  expect(cyclePackage?.installations[0]).toMatchObject({ id: 'cycle-provider', canEnable: false })
  const cycleLifecycle = { stop: 0, start: 0 }
  const rejectedCycle = await cycleFixture.manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: cycleInventory.inventory.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('cycle-provider') }, enabled: true,
  } }, hooks(cycleLifecycle), ready)
  expect(rejectedCycle).toMatchObject({ status: 'refused', error: { code: 'dependency-conflict' } })
  expect(cycleLifecycle).toEqual({ stop: 0, start: 0 })

  const childProviders = { route: { baseURL: 'https://child.invalid/v1' } }
  writeNativeProfile(cycleFixture.profile, [...initialHostRows,
    { id: 'model-provider', plugin: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: childProviders } },
    { id: 'sdk-child', plugin: '@deepseek-ai/dsh-sdk-child', scope: 'empty', disabled: true,
      config: { providerName: 'dsh-sdk' } },
  ], initialClientRows)
  prepareNativePackages(cycleFixture.profile)
  writeNativePackage(cycleFixture.profile, '@deepseek-ai/dsh-llm-pi-ai', ['host'], [], ['model'])
  writeNativePackage(cycleFixture.profile, '@deepseek-ai/dsh-sdk-child', ['host'], ['credentials', 'sdkChildRuntimeLauncher'],
    ['externalSubagentDriver'])
  writeNativePackage(cycleFixture.profile, '@deepseek-ai/dsh-subprocess-local', ['host'], [], ['childConnection'])
  writeNativePackage(cycleFixture.profile, '@deepseek-ai/dsh-sandbox-local', ['host'], [], ['sandbox'])
  const childInventory = await cycleFixture.manager.listNativeModules(ready)
  expect(childInventory.status).toBe('listed')
  if (childInventory.status !== 'listed') return
  expect(childInventory.inventory.packages.find(row => row.packageName === '@deepseek-ai/dsh-sdk-child')
    ?.installations[0]).toMatchObject({ id: 'sdk-child', canEnable: true })
  const childLifecycle = { stop: 0, start: 0 }
  const enabledChild = await cycleFixture.manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: childInventory.inventory.revision,
    key: { target: 'host', id: brandString<NativeDesktopInstallationId>('sdk-child') }, enabled: true,
  } }, hooks(childLifecycle), ready)
  expect(enabledChild.status).toBe('applied')
  expect(childLifecycle).toEqual({ stop: 1, start: 1 })
  const persistedHost = JSON.parse(readFileSync(join(cycleFixture.profile, 'rsh.profile.json'), 'utf8')) as {
    readonly installations: readonly NativeRow[]
  }
  expect(persistedHost.installations.some(row => row.id.startsWith('native-child-runtime/'))).toBe(false)
  expect(persistedHost.installations.find(row => row.id === 'sdk-child')).toEqual({
    id: 'sdk-child', plugin: '@deepseek-ai/dsh-sdk-child', scope: 'empty', config: { providerName: 'dsh-sdk' },
  })

  const noModelRoot = fixtureRoot()
  const noModelFixture = prepareFixture(noModelRoot)
  await noModelFixture.manager.applyRelease()
  writeNativeProfile(noModelFixture.profile, [...initialHostRows.slice(0, 3),
    { id: 'sdk-child-no-model', plugin: '@deepseek-ai/dsh-sdk-child', scope: 'empty', disabled: true, config: null },
  ], initialClientRows)
  prepareNativePackages(noModelFixture.profile)
  writeNativePackage(noModelFixture.profile, '@deepseek-ai/dsh-sdk-child', ['host'], ['credentials', 'sdkChildRuntimeLauncher'],
    ['externalSubagentDriver'])
  const noModelInventory = await noModelFixture.manager.listNativeModules(ready)
  expect(noModelInventory.status).toBe('listed')
  if (noModelInventory.status !== 'listed') return
  expect(noModelInventory.inventory.packages.find(row => row.packageName === '@deepseek-ai/dsh-sdk-child')
    ?.installations[0]).toMatchObject({ id: 'sdk-child-no-model', canEnable: false })
  const profileBeforeEnable = readFileSync(join(noModelFixture.profile, 'rsh.profile.json'), 'utf8')
  const noModelLifecycle = { stop: 0, start: 0 }
  const noModelResult = await noModelFixture.manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: noModelInventory.inventory.revision,
    key: { target: 'host', id: brandString<NativeDesktopInstallationId>('sdk-child-no-model') }, enabled: true,
  } }, hooks(noModelLifecycle), ready)
  expect(noModelResult).toMatchObject({ status: 'refused', error: { code: 'dependency-conflict' } })
  expect(noModelLifecycle).toEqual({ stop: 0, start: 0 })
  expect(readFileSync(join(noModelFixture.profile, 'rsh.profile.json'), 'utf8')).toBe(profileBeforeEnable)

  const invalidOptionalChildFixture = prepareFixture(fixtureRoot())
  await invalidOptionalChildFixture.manager.applyRelease()
  writeNativeProfile(invalidOptionalChildFixture.profile, [...initialHostRows,
    { id: 'model-provider', plugin: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: childProviders } },
    { id: 'optional-acp-child', plugin: '@deepseek-ai/dsh-acp-child', scope: 'empty',
      config: { providerName: '' } },
  ], initialClientRows)
  prepareNativePackages(invalidOptionalChildFixture.profile)
  writeNativePackage(invalidOptionalChildFixture.profile, '@deepseek-ai/dsh-llm-pi-ai', ['host'], [], ['model'])
  writeNativePackage(invalidOptionalChildFixture.profile, '@deepseek-ai/dsh-acp-child', ['host'],
    ['credentials', 'acpChildRuntimeLauncher'], ['externalSubagentDriver'])
  writeNativePackage(invalidOptionalChildFixture.profile, '@deepseek-ai/dsh-subprocess-local', ['host'], [], ['childConnection'])
  writeNativePackage(invalidOptionalChildFixture.profile, '@deepseek-ai/dsh-sandbox-local', ['host'], [], ['sandbox'])
  const invalidOptionalInventory = await invalidOptionalChildFixture.manager.listNativeModules(ready)
  expect(invalidOptionalInventory.status).toBe('listed')
  if (invalidOptionalInventory.status !== 'listed') return
  expect(invalidOptionalInventory.inventory.packages.find(row => row.packageName === '@deepseek-ai/dsh-acp-child')
    ?.installations[0]).toMatchObject({ id: 'optional-acp-child', canDisable: true })
  const invalidOptionalLifecycle = { stop: 0, start: 0 }
  const disableInvalidOptionalChild = await invalidOptionalChildFixture.manager.mutateNativeModules({
    type: 'disable-all', request: { expectedRevision: invalidOptionalInventory.inventory.revision },
  }, hooks(invalidOptionalLifecycle), ready)
  expect(disableInvalidOptionalChild.status).toBe('applied')
  expect(invalidOptionalLifecycle).toEqual({ stop: 1, start: 1 })
  const invalidOptionalProfile = JSON.parse(readFileSync(join(invalidOptionalChildFixture.profile, 'rsh.profile.json'), 'utf8')) as {
    readonly installations: readonly NativeRow[]
  }
  expect(invalidOptionalProfile.installations.find(row => row.id === 'optional-acp-child'))
    .toEqual({ id: 'optional-acp-child', plugin: '@deepseek-ai/dsh-acp-child', scope: 'empty',
      config: { providerName: '' }, disabled: true })

  const presetFixture = prepareFixture(fixtureRoot())
  await presetFixture.manager.applyRelease()
  configurePresetFixture(presetFixture.manager, presetFixture.profile, true)
  const expandedPreset = await expandNativeProfilePresets(
    readNativeProfile({ profile: 'desktop', profileDir: presetFixture.profile, patchFiles: [] }),
    [createRequire(join(presetFixture.manager.runtime.dsh, 'package.json')),
      createRequire(join(presetFixture.profile, 'package.json'))], dirname(presetFixture.manager.paths.root))
  expect(expandedPreset.installations.some(row => row.id === 'preset:review-local/consumer')).toBe(true)
  const presetInventory = await presetFixture.manager.listNativeModules(ready)
  expect(presetInventory.status).toBe('listed')
  if (presetInventory.status !== 'listed') return
  expect(presetInventory.inventory.packages.some(row => row.packageName === '@fixture/preset-consumer')).toBe(false)
  expect(presetInventory.inventory.packages.find(row => row.packageName === '@fixture/preset-root-provider')
    ?.installations[0]).toMatchObject({ id: 'preset-root-provider', canDisable: false })
  const presetProfileBefore = readFileSync(join(presetFixture.profile, 'rsh.profile.json'), 'utf8')
  const presetLifecycle = { stop: 0, start: 0 }
  const disablePresetProvider = await presetFixture.manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: presetInventory.inventory.revision,
    key: { target: 'host', id: brandString<NativeDesktopInstallationId>('preset-root-provider') }, enabled: false,
  } }, hooks(presetLifecycle), ready)
  expect(disablePresetProvider).toMatchObject({ status: 'refused', error: { code: 'dependency-conflict' } })
  expect(presetLifecycle).toEqual({ stop: 0, start: 0 })
  expect(readFileSync(join(presetFixture.profile, 'rsh.profile.json'), 'utf8')).toBe(presetProfileBefore)
  const disableAllPresets = await presetFixture.manager.mutateNativeModules({ type: 'disable-all', request: {
    expectedRevision: presetInventory.inventory.revision,
  } }, hooks(presetLifecycle), ready)
  expect(disableAllPresets.status).toBe('applied')
  expect(presetLifecycle).toEqual({ stop: 1, start: 1 })
  const presetProfile = JSON.parse(readFileSync(join(presetFixture.profile, 'rsh.profile.json'), 'utf8')) as {
    readonly scopes: readonly { readonly id: string }[]
    readonly installations: readonly NativeRow[]
  }
  expect(presetProfile.scopes.some(scope => scope.id === 'preset:review-local')).toBe(false)
  expect(presetProfile.installations.some(row => row.id.startsWith('preset:'))).toBe(false)
  expect(presetProfile.installations.find(row => row.id === 'preset-manager')).toEqual({
    id: 'preset-manager', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root',
  })
  expect(presetProfile.installations.find(row => row.id === 'preset-root-provider')?.disabled).toBeUndefined()

  const optionalPresetFixture = prepareFixture(fixtureRoot())
  await optionalPresetFixture.manager.applyRelease()
  configurePresetFixture(optionalPresetFixture.manager, optionalPresetFixture.profile, false)
  const optionalPresetInventory = await optionalPresetFixture.manager.listNativeModules(ready)
  expect(optionalPresetInventory.status).toBe('listed')
  if (optionalPresetInventory.status !== 'listed') return
  expect(optionalPresetInventory.inventory.packages.find(row => row.packageName === '@deepseek-ai/dsh-agent-presets')
    ?.installations[0]).toMatchObject({ id: 'preset-manager', canDisable: true })
  const optionalPresetLifecycle = { stop: 0, start: 0 }
  const disableOptionalPresets = await optionalPresetFixture.manager.mutateNativeModules({ type: 'disable-all', request: {
    expectedRevision: optionalPresetInventory.inventory.revision,
  } }, hooks(optionalPresetLifecycle), ready)
  expect(disableOptionalPresets.status).toBe('applied')
  expect(optionalPresetLifecycle).toEqual({ stop: 1, start: 1 })
  const optionalPresetProfile = JSON.parse(readFileSync(join(optionalPresetFixture.profile, 'rsh.profile.json'), 'utf8')) as {
    readonly scopes: readonly { readonly id: string }[]
    readonly installations: readonly NativeRow[]
  }
  expect(optionalPresetProfile.installations.find(row => row.id === 'preset-manager')?.disabled).toBe(true)
  expect(optionalPresetProfile.installations.find(row => row.id === 'preset-root-provider')?.disabled).toBe(true)
  expect(optionalPresetProfile.scopes.some(scope => scope.id === 'preset:review-local')).toBe(false)
  expect(optionalPresetProfile.installations.some(row => row.id.startsWith('preset:'))).toBe(false)
}, 15_000)

it('installs, updates, and removes exact Native packages without losing row configuration or disabled state', async () => {
  const root = fixtureRoot()
  const { manager, profile } = prepareFixture(root)
  await manager.applyRelease()
  writeCurrentProfile(manager, profile)
  const lifecycle = { stop: 0, start: 0 }
  const initial = await manager.listNativeModules(ready)
  expect(initial.status).toBe('listed')
  if (initial.status !== 'listed') return
  const installed = await manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: initial.inventory.revision,
    packageName: '@fixture/new-client', version: '1.0.0',
    installations: [{ target: 'client', id: brandString<NativeDesktopInstallationId>('new-client'),
      config: { label: 'keep-me' }, enabled: false }],
  } }, hooks(lifecycle), ready)
  expect(installed.status).toBe('applied')
  if (installed.status !== 'applied') return
  const client = readJson(join(profile, 'rsh.client.json')) as { installations: NativeRow[] }
  expect(client.installations.find(row => row.id === 'new-client')).toEqual({ id: 'new-client', plugin: '@fixture/new-client',
    config: { label: 'keep-me' }, disabled: true })

  const current = await manager.listNativeModules(ready)
  expect(current.status).toBe('listed')
  if (current.status !== 'listed') return
  const updated = await manager.mutateNativeModules({ type: 'update', request: {
    expectedRevision: current.inventory.revision, packageName: '@fixture/host-update', version: '1.1.0',
  } }, hooks(lifecycle), ready)
  expect(updated.status).toBe('applied')
  if (updated.status !== 'applied') return
  const afterUpdate = await manager.listNativeModules(ready)
  expect(afterUpdate.status).toBe('listed')
  if (afterUpdate.status !== 'listed') return
  expect(afterUpdate.inventory.packages.find(row => row.packageName === '@fixture/host-update')?.packageVersion).toBe('1.1.0')
  const updatedClient = readJson(join(profile, 'rsh.client.json')) as { installations: NativeRow[] }
  expect(updatedClient.installations.find(row => row.id === 'optional-client')).toEqual(initialClientRows[3])

  const removed = await manager.mutateNativeModules({ type: 'remove', request: {
    expectedRevision: afterUpdate.inventory.revision, packageName: '@fixture/new-client',
  } }, hooks(lifecycle), ready)
  expect(removed.status).toBe('applied')
  if (removed.status !== 'applied') return
  expect(existsSync(join(profile, 'node_modules/@fixture/new-client'))).toBe(false)
  expect((await manager.listNativeModules(ready)).status).toBe('listed')
  const beforeUnsupported = await manager.listNativeModules(ready)
  expect(beforeUnsupported.status).toBe('listed')
  if (beforeUnsupported.status !== 'listed') return
  const unsupported = await manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: beforeUnsupported.inventory.revision, packageName: '@fixture/unsupported-client', version: '1.0.0',
    installations: [{ target: 'client', id: brandString<NativeDesktopInstallationId>('unsupported-client'), config: undefined, enabled: false }],
  } }, hooks(lifecycle), ready)
  expect(unsupported).toMatchObject({ status: 'recovery-required', error: {
    code: 'unsupported-module', messageKey: 'nativeUnsupportedModule', backend: { phase: 'ready', profileRecovery: true },
  } })
  expect(existsSync(join(profile, 'desktop-packages-pending'))).toBe(true)
  expect(lifecycle).toEqual({ stop: 4, start: 3 })
}, 15_000)
