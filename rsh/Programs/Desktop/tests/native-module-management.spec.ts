/** Native Desktop profile inventory, package operations, and lifecycle outcomes. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from '../src/project-manager.ts'
import type { NativeDesktopInstallationId, NativeDesktopScopeId } from '../src/native-module-management.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { expandNativeProfilePresets, readNativeProfile } from '@deepseek-ai/dsh/native-profile'
import { parseNativeClientProfile, prepareNativeClientProfileBundle } from '@deepseek-ai/dsh-native-web-assets/native-client'
import { readDesktopRuntime, writeDesktopRuntime } from '../src/runtime-tree.ts'
import type { DesktopBackendState } from '../src/backend-controller.ts'
import { runtimeFixture, writePackage } from './runtime-fixture.ts'

(globalThis as Record<string, unknown>).__dshDesktopTestPrepareNativeClientProfileBundle = prepareNativeClientProfileBundle

const roots: string[] = []

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-desktop-'))
  roots.push(root)
  return root
}

function writeNativePackage(profile: string, name: string, targets: readonly ('host' | 'client')[],
  requires: readonly string[], provides: readonly string[], version = '1.0.0', optional: readonly string[] = [],
  sourcePrefix = '', peerDependencies: Record<string, string> = {}): void {
  const directory = join(profile, 'node_modules', ...name.split('/'))
  mkdirSync(directory, { recursive: true })
  const entry = { apiVersion: 1, entry: './native', targets, requires, optional, provides }
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, type: 'module',
    ...Object.keys(peerDependencies).length === 0 ? {} : { peerDependencies },
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
  { id: 'layout', plugin: '@fixture/client-layout' },
  { id: 'session-presentation', plugin: '@fixture/client-session-presentation' },
]

function prepareFixture(root: string): { manager: DesktopProjectManager; profile: string } {
  const runtime = join(root, 'resources', 'dsh')
  runtimeFixture(runtime)
  // The runtime's native import bypasses Vitest source aliases.
  writePackage(join(runtime, 'node_modules'), '@deepseek-ai/dsh-native-web-assets',
    { exports: { './native-client': './index.js' } },
    'export const prepareNativeClientProfileBundle = (...args) => globalThis.__dshDesktopTestPrepareNativeClientProfileBundle(...args)')
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
  writeNativePackage(profile, '@fixture/client-layout', ['client'], ['clientNativeSessionPresentation'], ['clientNativeLayout'])
  writeNativePackage(profile, '@fixture/client-session-presentation', ['client'], [], ['clientNativeSessionPresentation'])
}

function writePiAiNativePackage(profile: string): void {
  const packageDir = fileURLToPath(new URL('../../../Modules/Official/llm/llm-pi-ai/', import.meta.url))
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
  manifest.version = '1.0.0'
  const directory = join(profile, 'node_modules/@deepseek-ai/dsh-llm-pi-ai')
  mkdirSync(join(directory, 'lib'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(directory, 'lib/native.js'),
    `export { plugin } from ${JSON.stringify(pathToFileURL(join(packageDir, 'src/native.ts')).href)}\n`)
}

function writeNativePnpm(root: string): string {
  const script = join(root, 'native-pnpm.mjs')
  const log = join(root, 'native-pnpm.jsonl')
  const recoveryPackages = join(root, 'native-pnpm-recovery-packages')
  const failRecoveryInstall = join(root, 'native-pnpm-fail-recovery-install')
  const failReservedInstall = join(root, 'native-pnpm-fail-reserved-install')
  writeFileSync(script, `
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const command = args.find(value => ['add', 'remove', 'rebuild', 'install'].includes(value))
const project = process.cwd()
const modules = join(project, 'node_modules')
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n')
if (command === 'add' || command === 'remove') {
  rmSync(${JSON.stringify(recoveryPackages)}, { recursive: true, force: true })
  if (existsSync(modules)) cpSync(modules, ${JSON.stringify(recoveryPackages)}, { recursive: true })
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
    const targets = name === '@fixture/unsupported-client' ? ['legacy']
      : name === '@fixture/new-client' ? ['host', 'client'] : ['client']
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
  if (command === 'add' && existsSync(${JSON.stringify(failReservedInstall)})) {
    rmSync(${JSON.stringify(failReservedInstall)})
    const reserved = join(modules, '@deepseek-ai', 'cordis')
    if (existsSync(reserved)) {
      if (lstatSync(reserved).isSymbolicLink()) unlinkSync(reserved)
      else rmSync(reserved, { recursive: true, force: true })
    }
    mkdirSync(reserved, { recursive: true })
    writeFileSync(join(reserved, 'package.json'), JSON.stringify({ name: '@deepseek-ai/cordis', version: '1.0.0' }))
    process.exitCode = 1
  }
} else if (command === 'install') {
  if (existsSync(modules)) throw new Error('recovery install expected an empty node_modules directory')
  if (existsSync(${JSON.stringify(failRecoveryInstall)})) {
    rmSync(${JSON.stringify(failRecoveryInstall)})
    process.stderr.write('fixture recovery install failed')
    process.exitCode = 1
  } else {
    const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies)) {
      const source = join(${JSON.stringify(recoveryPackages)}, ...name.split('/'))
      if (existsSync(source)) cpSync(source, join(modules, ...name.split('/')), { recursive: true })
    }
  }
}
`)
  return script
}

function writeCurrentProfile(profile: string): void {
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
  const lockImporter = (presetLock.importers as { '.': { dependencies: Record<string, unknown> } })['.']
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
  const hostProfilePath = join(profile, 'rsh.profile.json')
  const clientProfilePath = join(profile, 'rsh.client.json')
  await manager.applyRelease()
  writeNativeProfile(profile, initialHostRows, initialClientRows.map(row => row.id === 'layout' || row.id === 'session-presentation'
    ? { ...row, disabled: true } : row))
  prepareNativePackages(profile)
  const lifecycle = { stop: 0, start: 0 }
  const listed = await manager.listNativeModules(ready)
  expect(listed.status).toBe('listed')
  if (listed.status !== 'listed') return
  expect(listed.inventory.scopes.map(scope => scope.id)).toEqual(['root', 'empty'])
  expect(JSON.stringify(listed.inventory)).not.toContain('private-host-value')
  expect(JSON.stringify(listed.inventory)).not.toContain('private-client-value')
  const presentationEnabled = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: listed.inventory.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('session-presentation') }, enabled: true,
  } }, hooks(lifecycle), ready)
  expect(presentationEnabled.status).toBe('applied')
  if (presentationEnabled.status !== 'applied') return
  const layoutEnabled = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: presentationEnabled.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('layout') }, enabled: true,
  } }, hooks(lifecycle), ready)
  expect(layoutEnabled.status).toBe('applied')
  if (layoutEnabled.status !== 'applied') return
  const enabledClient = readJson(clientProfilePath) as { installations: NativeRow[] }
  expect(enabledClient.installations.filter(row => row.id === 'layout' || row.id === 'session-presentation')
    .every(row => row.disabled !== true)).toBe(true)
  const enabledListing = await manager.listNativeModules(ready)
  expect(enabledListing.status).toBe('listed')
  if (enabledListing.status !== 'listed') return
  expect(enabledListing.inventory.packages.find(row => row.packageName === '@fixture/client-layout')?.installations[0])
    .toMatchObject({ id: 'layout', canDisable: false, disableReasons: ['client-boot-requirement'] })
  expect(enabledListing.inventory.packages.find(row => row.packageName === '@fixture/client-session-presentation')?.installations[0])
    .toMatchObject({ id: 'session-presentation', canDisable: false, disableReasons: ['required-provider'] })
  const applied = await manager.mutateNativeModules({ type: 'disable-all', request: { expectedRevision: enabledListing.inventory.revision } },
    hooks(lifecycle), ready)
  expect(applied.status).toBe('applied')
  const host = readJson(hostProfilePath) as { installations: NativeRow[] }
  const client = readJson(clientProfilePath) as { installations: NativeRow[] }
  expect(host.installations.filter(row => row.disabled !== true).map(row => row.id)).toEqual(['credentials', 'native-session'])
  expect(host.installations.find(row => row.id === 'optional-host')).toMatchObject({ disabled: true, config: { token: 'private-host-value' } })
  expect(host.installations.find(row => row.id === 'already-disabled')).toMatchObject({ ...initialHostRows[4], scope: 'root' })
  expect(client.installations.filter(row => row.disabled !== true).map(row => row.id))
    .toEqual(['client-state', 'client-app', 'client-renderer', 'layout', 'session-presentation'])
  expect(client.installations.find(row => row.id === 'optional-client')).toMatchObject({ disabled: true, config: 'private-client-value' })
  expect(client.installations.find(row => row.id === 'client-already-disabled')).toEqual(initialClientRows[4])
  expect(lifecycle).toEqual({ stop: 3, start: 3 })
  const after = await manager.listNativeModules(ready)
  expect(after.status).toBe('listed')
  if (after.status !== 'listed') return
  const noOp = await manager.mutateNativeModules({ type: 'disable-all', request: { expectedRevision: after.inventory.revision } },
    hooks(lifecycle), ready)
  expect(noOp).toMatchObject({ status: 'applied', revision: after.inventory.revision })
  const staleHostBefore = readFileSync(hostProfilePath, 'utf8')
  const staleClientBefore = readFileSync(clientProfilePath, 'utf8')
  const stale = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: listed.inventory.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('optional-client') }, enabled: true,
  } }, hooks(lifecycle), ready)
  expect(stale).toMatchObject({ status: 'refused', error: {
    code: 'stale-revision', messageKey: 'nativeStaleRevision', currentRevision: after.inventory.revision,
  } })
  expect(readFileSync(hostProfilePath, 'utf8')).toBe(staleHostBefore)
  expect(readFileSync(clientProfilePath, 'utf8')).toBe(staleClientBefore)
  const requiredHostBefore = readFileSync(hostProfilePath, 'utf8')
  const requiredClientBefore = readFileSync(clientProfilePath, 'utf8')
  const required = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: after.inventory.revision,
    key: { target: 'host', id: brandString<NativeDesktopInstallationId>('native-session') }, enabled: false,
  } }, hooks(lifecycle), ready)
  expect(required).toMatchObject({ status: 'refused', error: {
    code: 'dependency-conflict', blockedBy: [{ target: 'host', id: 'native-session' }],
  } })
  expect(readFileSync(hostProfilePath, 'utf8')).toBe(requiredHostBefore)
  expect(readFileSync(clientProfilePath, 'utf8')).toBe(requiredClientBefore)
  const fakeToken = 'native-desktop-fake-token'
  const fakeHeaderName = `Authorization: Bearer ${fakeToken}`
  const preflightFixture = prepareFixture(fixtureRoot())
  await preflightFixture.manager.applyRelease()
  writeNativeProfile(preflightFixture.profile, [...initialHostRows,
    { id: 'pi-ai-invalid-header', plugin: '@deepseek-ai/dsh-llm-pi-ai', disabled: true, config: {
      providers: { gateway: {
        api: 'openai-completions', baseURL: 'https://gateway.invalid/v1',
        models: [{ id: 'test-model', name: 'Test Model' }],
        headers: { [fakeHeaderName]: 'value' },
      } },
    } },
  ], initialClientRows)
  prepareNativePackages(preflightFixture.profile)
  writePiAiNativePackage(preflightFixture.profile)
  const preflightInventory = await preflightFixture.manager.listNativeModules(ready)
  expect(preflightInventory.status).toBe('listed')
  if (preflightInventory.status !== 'listed') return
  expect(preflightInventory.inventory.packages.find(row => row.packageName === '@deepseek-ai/dsh-llm-pi-ai')
    ?.installations[0]).toMatchObject({ id: 'pi-ai-invalid-header', canEnable: true })
  const preflightHostBefore = readFileSync(join(preflightFixture.profile, 'rsh.profile.json'), 'utf8')
  const preflightClientBefore = readFileSync(join(preflightFixture.profile, 'rsh.client.json'), 'utf8')
  const preflightLifecycle = { stop: 0, start: 0 }
  const preflightRefusal = await preflightFixture.manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: preflightInventory.inventory.revision,
    key: { target: 'host', id: brandString<NativeDesktopInstallationId>('pi-ai-invalid-header') }, enabled: true,
  } }, hooks(preflightLifecycle), ready)
  const diagnosticValues: unknown[] = [preflightRefusal]
  const diagnosticSeen = new Set<object>()
  let diagnosticErrors = 0
  while (diagnosticValues.length > 0) {
    const value = diagnosticValues.pop()
    if (value instanceof Error) {
      diagnosticErrors += 1
      for (const detail of [value.message, value.stack, 'detail' in value ? value.detail : undefined]) {
        if (typeof detail !== 'string') continue
        expect(detail).not.toContain(fakeToken)
        expect(detail).not.toContain(fakeHeaderName)
        expect(detail).not.toContain('Authorization')
      }
      diagnosticValues.push(value.cause)
      if (value instanceof AggregateError) {
        for (const nested of value.errors as unknown[]) diagnosticValues.push(nested)
      }
    } else if (typeof value === 'object' && value !== null && !diagnosticSeen.has(value)) {
      diagnosticSeen.add(value)
      for (const nested of Object.values(value) as unknown[]) diagnosticValues.push(nested)
    }
  }
  expect(diagnosticErrors).toBe(0)
  expect(JSON.stringify(preflightRefusal)).not.toContain(fakeToken)
  expect(JSON.stringify(preflightRefusal)).not.toContain(fakeHeaderName)
  expect(preflightRefusal).toMatchObject({ status: 'refused', error: { code: 'dependency-conflict' } })
  if (preflightRefusal.status !== 'refused') return
  expect(preflightRefusal.error.diagnostic).toEqual({ path: 'providers.0.headers.0', rule: 'valid-fetch-header' })
  expect(preflightLifecycle).toEqual({ stop: 0, start: 0 })
  expect(readFileSync(join(preflightFixture.profile, 'rsh.profile.json'), 'utf8')).toBe(preflightHostBefore)
  expect(readFileSync(join(preflightFixture.profile, 'rsh.client.json'), 'utf8')).toBe(preflightClientBefore)
  writeFileSync(manager.paths.lock, String(process.pid))
  try {
    expect(await manager.listNativeModules(ready)).toMatchObject({ status: 'refused', error: { code: 'busy' } })
    const busyHostBefore = readFileSync(hostProfilePath, 'utf8')
    const busyClientBefore = readFileSync(clientProfilePath, 'utf8')
    const busy = await manager.mutateNativeModules({ type: 'toggle', request: {
      expectedRevision: after.inventory.revision,
      key: { target: 'client', id: brandString<NativeDesktopInstallationId>('optional-client') }, enabled: true,
    } }, hooks(lifecycle), ready)
    expect(busy).toMatchObject({ status: 'refused', error: { code: 'busy' } })
    expect(readFileSync(hostProfilePath, 'utf8')).toBe(busyHostBefore)
    expect(readFileSync(clientProfilePath, 'utf8')).toBe(busyClientBefore)
  } finally {
    if (existsSync(manager.paths.lock)) rmSync(manager.paths.lock)
  }
  expect(lifecycle).toEqual({ stop: 3, start: 3 })

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
  writeCurrentProfile(profile)
  const lifecycle = { stop: 0, start: 0 }
  const initial = await manager.listNativeModules(ready)
  expect(initial.status).toBe('listed')
  if (initial.status !== 'listed') return
  let releaseStop!: () => void
  let stopStarted!: () => void
  const stopGate = new Promise<void>((resolve) => { releaseStop = resolve })
  const stopStartedPromise = new Promise<void>((resolve) => { stopStarted = resolve })
  const hostBeforeStop = readFileSync(join(profile, 'rsh.profile.json'), 'utf8')
  const clientBeforeStop = readFileSync(join(profile, 'rsh.client.json'), 'utf8')
  const pendingInstall = manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: initial.inventory.revision,
    packageName: '@fixture/new-client', version: '1.0.0',
    installations: [
      { target: 'client', id: brandString<NativeDesktopInstallationId>('new-client'), config: { label: 'keep-me' }, enabled: true },
      { target: 'host', id: brandString<NativeDesktopInstallationId>('new-host'), scope: brandString<NativeDesktopScopeId>('root'),
        config: undefined, enabled: true },
    ],
  } }, {
    beforeChange: async () => { lifecycle.stop += 1; stopStarted(); await stopGate },
    afterChange: async () => { lifecycle.start += 1 },
  }, ready)
  const reachedStop = await Promise.race([stopStartedPromise.then(() => true), pendingInstall.then(() => false)])
  const hostWhileStopped = readFileSync(join(profile, 'rsh.profile.json'), 'utf8')
  const clientWhileStopped = readFileSync(join(profile, 'rsh.client.json'), 'utf8')
  const packageWhileStopped = existsSync(join(profile, 'node_modules/@fixture/new-client'))
  const pendingMarkerWhileStopped = existsSync(join(profile, 'desktop-packages-pending'))
  releaseStop()
  const installed = await pendingInstall
  expect(reachedStop).toBe(true)
  expect(hostWhileStopped).toBe(hostBeforeStop)
  expect(clientWhileStopped).toBe(clientBeforeStop)
  expect(packageWhileStopped).toBe(false)
  expect(pendingMarkerWhileStopped).toBe(false)
  expect(installed.status).toBe('applied')
  if (installed.status !== 'applied') return
  const client = readJson(join(profile, 'rsh.client.json')) as { installations: NativeRow[] }
  expect(client.installations.find(row => row.id === 'new-client')).toEqual({ id: 'new-client', plugin: '@fixture/new-client',
    config: { label: 'keep-me' } })
  expect(client.installations.find(row => row.id === 'client-already-disabled')?.disabled).toBe(true)
  const host = readJson(join(profile, 'rsh.profile.json')) as { installations: NativeRow[] }
  expect(host.installations.find(row => row.id === 'new-host')).toEqual({ id: 'new-host', plugin: '@fixture/new-client', scope: 'root' })
  expect(host.installations.find(row => row.id === 'already-disabled')?.disabled).toBe(true)

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
  expect(updatedClient.installations.find(row => row.id === 'client-already-disabled')?.disabled).toBe(true)
  const updatedHost = readJson(join(profile, 'rsh.profile.json')) as { installations: NativeRow[] }
  expect(updatedHost.installations.find(row => row.id === 'already-disabled')?.disabled).toBe(true)

  const clientBeforeRemoval = parseNativeClientProfile(readJson(join(profile, 'rsh.client.json')))
  const clientBundleBeforeRemoval = await prepareNativeClientProfileBundle(profile, join(root, 'resources', 'dsh'), clientBeforeRemoval, true)
  expect(clientBundleBeforeRemoval.wire.modules.some(row => row.id === 'new-client')).toBe(true)

  const removed = await manager.mutateNativeModules({ type: 'remove', request: {
    expectedRevision: afterUpdate.inventory.revision, packageName: '@fixture/new-client',
  } }, hooks(lifecycle), ready)
  expect(removed.status).toBe('applied')
  if (removed.status !== 'applied') return
  expect(existsSync(join(profile, 'node_modules/@fixture/new-client'))).toBe(false)
  const hostAfterRemoval = readJson(join(profile, 'rsh.profile.json')) as { installations: NativeRow[] }
  const clientAfterRemoval = parseNativeClientProfile(readJson(join(profile, 'rsh.client.json')))
  // These assertions cover saved configuration and bundle projection; mounted withdrawal remains GUI acceptance.
  expect(hostAfterRemoval.installations.some(row => row.id === 'new-host')).toBe(false)
  expect(clientAfterRemoval.installations.some(row => row.id === 'new-client')).toBe(false)
  const clientBundle = await prepareNativeClientProfileBundle(profile, join(root, 'resources', 'dsh'), clientAfterRemoval, true)
  expect(clientBundle.wire.modules.some(row => row.id === 'new-client')).toBe(false)
  const toggleInventory = await manager.listNativeModules(ready)
  expect(toggleInventory.status).toBe('listed')
  if (toggleInventory.status !== 'listed') return
  const hostBeforeToggle = readFileSync(join(profile, 'rsh.profile.json'), 'utf8')
  const clientBeforeToggle = readFileSync(join(profile, 'rsh.client.json'), 'utf8')
  let releaseToggleStop!: () => void
  let toggleStopStarted!: () => void
  let releaseToggleStart!: () => void
  let toggleStartStarted!: () => void
  const toggleStopGate = new Promise<void>((resolve) => { releaseToggleStop = resolve })
  const toggleStopStartedPromise = new Promise<void>((resolve) => { toggleStopStarted = resolve })
  const toggleStartGate = new Promise<void>((resolve) => { releaseToggleStart = resolve })
  const toggleStartStartedPromise = new Promise<void>((resolve) => { toggleStartStarted = resolve })
  const toggleLifecycle = { stop: 0, start: 0 }
  const pendingToggle = manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: toggleInventory.inventory.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('optional-client') }, enabled: false,
  } }, {
    beforeChange: async () => { toggleLifecycle.stop += 1; toggleStopStarted(); await toggleStopGate },
    afterChange: async () => { toggleLifecycle.start += 1; toggleStartStarted(); await toggleStartGate },
  }, ready)
  await toggleStopStartedPromise
  const hostWhileToggleStopped = readFileSync(join(profile, 'rsh.profile.json'), 'utf8')
  const clientWhileToggleStopped = readFileSync(join(profile, 'rsh.client.json'), 'utf8')
  releaseToggleStop()
  await toggleStartStartedPromise
  let toggleSettledBeforeStart = false
  void pendingToggle.then(() => { toggleSettledBeforeStart = true })
  await new Promise<void>(resolve => setImmediate(resolve))
  const settledBeforeStart = toggleSettledBeforeStart
  releaseToggleStart()
  const toggled = await pendingToggle
  expect(hostWhileToggleStopped).toBe(hostBeforeToggle)
  expect(clientWhileToggleStopped).toBe(clientBeforeToggle)
  expect(settledBeforeStart).toBe(false)
  expect(toggled.status).toBe('applied')
  expect(toggleLifecycle).toEqual({ stop: 1, start: 1 })
  if (toggled.status !== 'applied') return
  expect((readJson(join(profile, 'rsh.client.json')) as { installations: NativeRow[] })
    .installations.find(row => row.id === 'optional-client')).toMatchObject({ disabled: true })

  const stopFailureFiles = {
    host: readFileSync(join(profile, 'rsh.profile.json'), 'utf8'),
    client: readFileSync(join(profile, 'rsh.client.json'), 'utf8'),
  }
  const stopFailureLifecycle = { stop: 0, start: 0 }
  // DesktopBackendController.stop() reports `starting` before its cleanup can reject.
  let stopFailureBackend: DesktopBackendState = { phase: 'ready' }
  const stopFailure = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: toggled.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('optional-client') }, enabled: true,
  } }, {
    beforeChange: async () => {
      stopFailureLifecycle.stop += 1
      stopFailureBackend = { phase: 'starting' }
      throw new Error('Host stop failed')
    },
    afterChange: async () => { stopFailureLifecycle.start += 1 },
  }, () => stopFailureBackend)
  expect(stopFailure).toMatchObject({
    status: 'recovery-required', error: { code: 'host-stop-failed', backend: { phase: 'starting' } },
  })
  expect(stopFailureLifecycle).toEqual({ stop: 1, start: 0 })
  expect(readFileSync(join(profile, 'rsh.profile.json'), 'utf8')).toBe(stopFailureFiles.host)
  expect(readFileSync(join(profile, 'rsh.client.json'), 'utf8')).toBe(stopFailureFiles.client)

  const startFailureFiles = {
    host: readFileSync(join(profile, 'rsh.profile.json')),
    client: readFileSync(join(profile, 'rsh.client.json')),
  }
  let startFailureCalls = 0
  const startFailure = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: toggled.revision,
    key: { target: 'client', id: brandString<NativeDesktopInstallationId>('optional-client') }, enabled: true,
  } }, {
    beforeChange: async () => {},
    afterChange: async () => {
      startFailureCalls += 1
      if (startFailureCalls === 1) throw new Error('Host start failed')
    },
  }, ready)
  expect(startFailure).toMatchObject({ status: 'refused', error: { code: 'host-start-failed', backend: { phase: 'ready' } } })
  expect(startFailureCalls).toBe(2)
  expect(readFileSync(join(profile, 'rsh.profile.json'))).toEqual(startFailureFiles.host)
  expect(readFileSync(join(profile, 'rsh.client.json'))).toEqual(startFailureFiles.client)

  const beforeUnsupported = await manager.listNativeModules(ready)
  expect(beforeUnsupported.status).toBe('listed')
  if (beforeUnsupported.status !== 'listed') return
  const manifestBeforeUnsupported = readFileSync(join(profile, 'package.json'))
  const lockBeforeUnsupported = readFileSync(join(profile, 'pnpm-lock.yaml'))
  let oldPackagesVisibleOnRestart = false
  const unsupportedHooks: DesktopProjectHooks = {
    beforeChange: async () => { lifecycle.stop += 1 },
    afterChange: async () => {
      lifecycle.start += 1
      oldPackagesVisibleOnRestart = existsSync(join(profile, 'node_modules/@fixture/host-update/package.json'))
        && existsSync(join(profile, 'node_modules/@fixture/client-renderer/package.json'))
        && !existsSync(join(profile, 'node_modules/@fixture/unsupported-client'))
        && !existsSync(join(profile, 'desktop-packages-pending'))
    },
  }
  const unsupported = await manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: beforeUnsupported.inventory.revision, packageName: '@fixture/unsupported-client', version: '1.0.0',
    installations: [{ target: 'client', id: brandString<NativeDesktopInstallationId>('unsupported-client'), config: undefined, enabled: false }],
  } }, unsupportedHooks, ready)
  expect(unsupported).toMatchObject({ status: 'refused', error: {
    code: 'unsupported-module', messageKey: 'nativeUnsupportedModule', backend: { phase: 'ready' },
  } })
  expect(readFileSync(join(profile, 'package.json'))).toEqual(manifestBeforeUnsupported)
  expect(readFileSync(join(profile, 'pnpm-lock.yaml'))).toEqual(lockBeforeUnsupported)
  expect(existsSync(join(profile, 'desktop-packages-pending'))).toBe(false)
  expect(oldPackagesVisibleOnRestart).toBe(true)
  expect(lifecycle).toEqual({ stop: 4, start: 4 })

  const pnpmLog = join(root, 'native-pnpm.jsonl')
  const successfulRecoveryCalls = readFileSync(pnpmLog, 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as string[])
  const successfulInstallIndex = successfulRecoveryCalls.findIndex(args => args.slice(args.indexOf('install')).join(' ')
    === 'install --frozen-lockfile --ignore-scripts')
  expect(successfulInstallIndex).toBeGreaterThanOrEqual(0)
  expect(successfulRecoveryCalls[successfulInstallIndex + 1]?.slice(
    successfulRecoveryCalls[successfulInstallIndex + 1]?.indexOf('rebuild'))).toEqual(['rebuild', '--pending'])

  const emptyRoot = fixtureRoot()
  const emptyFixture = prepareFixture(emptyRoot)
  const emptyRuntime = join(emptyRoot, 'resources', 'dsh')
  const runtimeDescriptor = readDesktopRuntime(emptyRuntime)
  const noDependencyHostRows = [initialHostRows[0]!, initialHostRows[1]!]
  const noDependencyClientRows = [initialClientRows[0]!, initialClientRows[1]!, initialClientRows[2]!,
    initialClientRows[5]!, initialClientRows[6]!]
  const noDependencyPackages = [...noDependencyHostRows, ...noDependencyClientRows].map(row => row.plugin)
  writeNativePackage(emptyRuntime, '@fixture/credentials', ['host'], ['launchEnvironment'], ['credentials'])
  writeNativePackage(emptyRuntime, '@fixture/native-session', ['host'],
    ['credentials', 'hostConnection', 'pluginInventory'], ['nativeWebSession'])
  writeNativePackage(emptyRuntime, '@fixture/client-state', ['client'], [], ['clientState'])
  writeNativePackage(emptyRuntime, '@fixture/client-app', ['client'], ['clientState'], ['clientApplication'])
  writeNativePackage(emptyRuntime, '@fixture/client-renderer', ['client'], [], ['clientRenderer'])
  writeNativePackage(emptyRuntime, '@fixture/client-layout', ['client'], ['clientNativeSessionPresentation'], ['clientNativeLayout'])
  writeNativePackage(emptyRuntime, '@fixture/client-session-presentation', ['client'], [], ['clientNativeSessionPresentation'])
  writeDesktopRuntime(emptyRuntime, runtimeDescriptor.release, [
    ...runtimeDescriptor.sharedPackages.map(row => row.name), ...noDependencyPackages,
  ])
  await emptyFixture.manager.applyRelease()
  writeNativeProfile(emptyFixture.profile, noDependencyHostRows, noDependencyClientRows)
  const emptyManifest = readJson(join(emptyFixture.profile, 'package.json'))
  emptyManifest.dependencies = {}
  writeFileSync(join(emptyFixture.profile, 'package.json'), JSON.stringify(emptyManifest))
  const emptyLock = join(emptyFixture.profile, 'pnpm-lock.yaml')
  rmSync(emptyLock)
  const emptyInventory = await emptyFixture.manager.listNativeModules(ready)
  expect(emptyInventory.status).toBe('listed')
  if (emptyInventory.status !== 'listed') return
  let emptyRestartCalls = 0
  let emptyProfileRestored = false
  const emptyProfileInstall = await emptyFixture.manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: emptyInventory.inventory.revision, packageName: '@fixture/new-client', version: '1.0.0',
    installations: [{ target: 'client', id: brandString<NativeDesktopInstallationId>('empty-client'),
      config: undefined, enabled: false }],
  } }, {
    beforeChange: async () => {},
    afterChange: async () => {
      emptyRestartCalls += 1
      if (emptyRestartCalls === 1) throw new Error('New Host start failed')
      emptyProfileRestored = !existsSync(emptyLock)
        && !existsSync(join(emptyFixture.profile, 'node_modules/@fixture/new-client'))
        && existsSync(join(emptyFixture.profile, 'node_modules/@deepseek-ai/cordis'))
        && !existsSync(join(emptyFixture.profile, 'desktop-packages-pending'))
    },
  }, ready)
  expect(emptyProfileInstall).toMatchObject({ status: 'refused', error: { code: 'host-start-failed' } })
  expect(emptyRestartCalls).toBe(2)
  expect(emptyProfileRestored).toBe(true)
  const emptyPnpmCalls = readFileSync(join(emptyRoot, 'native-pnpm.jsonl'), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as string[])
  expect(emptyPnpmCalls.some(args => args.includes('install'))).toBe(false)
  expect(emptyPnpmCalls.filter(args => args.slice(args.indexOf('rebuild')).join(' ') === 'rebuild --pending'))
    .toHaveLength(2)

  const manifestWithoutLock = readJson(join(emptyFixture.profile, 'package.json'))
  manifestWithoutLock.dependencies = { '@fixture/unlocked-dependency': '1.0.0' }
  writeFileSync(join(emptyFixture.profile, 'package.json'), JSON.stringify(manifestWithoutLock))
  writeNativePackage(emptyFixture.profile, '@fixture/unlocked-dependency', ['client'], [], [])
  const unlockedInventory = await emptyFixture.manager.listNativeModules(ready)
  expect(unlockedInventory.status).toBe('listed')
  if (unlockedInventory.status !== 'listed') return
  let stoppedForMissingLock = false
  const missingLock = await emptyFixture.manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: unlockedInventory.inventory.revision, packageName: '@fixture/new-client', version: '1.0.0',
    installations: [{ target: 'client', id: brandString<NativeDesktopInstallationId>('unlocked-client'),
      config: undefined, enabled: false }],
  } }, {
    beforeChange: async () => { stoppedForMissingLock = true },
    afterChange: async () => {},
  }, ready)
  expect(missingLock).toMatchObject({ status: 'refused', error: { code: 'profile-invalid' } })
  expect(stoppedForMissingLock).toBe(false)
  expect(existsSync(emptyLock)).toBe(false)

  const hostProfilePath = join(profile, 'rsh.profile.json')
  const clientProfilePath = join(profile, 'rsh.client.json')
  const beforePartialWrite = { host: readFileSync(hostProfilePath), client: readFileSync(clientProfilePath) }
  let oldHostRestarted = false
  const partialWrite = await manager.mutateNativeModules({ type: 'toggle', request: {
    expectedRevision: beforeUnsupported.inventory.revision,
    key: { target: 'host', id: brandString<NativeDesktopInstallationId>('optional-host') }, enabled: false,
  } }, {
    beforeChange: async () => {
      rmSync(clientProfilePath)
      mkdirSync(clientProfilePath)
    },
    afterChange: async () => { oldHostRestarted = readFileSync(hostProfilePath).equals(beforePartialWrite.host) },
  }, ready)
  expect(partialWrite).toMatchObject({ status: 'refused', error: { code: 'profile-invalid' } })
  expect(readFileSync(hostProfilePath)).toEqual(beforePartialWrite.host)
  expect(readFileSync(clientProfilePath)).toEqual(beforePartialWrite.client)
  expect(oldHostRestarted).toBe(true)

  const beforeReservedFailure = { host: readFileSync(hostProfilePath), client: readFileSync(clientProfilePath) }
  const reservedMarker = join(root, 'native-pnpm-fail-reserved-install')
  writeFileSync(reservedMarker, '')
  const profileCordis = join(profile, 'node_modules', '@deepseek-ai', 'cordis')
  const bundledCordis = join(root, 'resources', 'dsh', 'node_modules', '@deepseek-ai', 'cordis')
  let oldHostRestartedAfterReservedFailure = false
  const callsBeforeReservedFailure = readFileSync(pnpmLog, 'utf8').trim().split('\n').length
  const reservedFailure = await manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: beforeUnsupported.inventory.revision, packageName: '@fixture/new-client', version: '1.0.0',
    installations: [{ target: 'client', id: brandString<NativeDesktopInstallationId>('reserved-client'),
      config: undefined, enabled: false }],
  } }, {
    beforeChange: async () => {},
    afterChange: async () => {
      oldHostRestartedAfterReservedFailure = existsSync(profileCordis) && lstatSync(profileCordis).isSymbolicLink()
        && existsSync(join(bundledCordis, 'package.json'))
        && !existsSync(join(profile, 'node_modules/@fixture/new-client'))
        && !existsSync(join(profile, 'desktop-packages-pending'))
    },
  }, ready)
  expect(reservedFailure.status).toBe('refused')
  expect(readFileSync(hostProfilePath)).toEqual(beforeReservedFailure.host)
  expect(readFileSync(clientProfilePath)).toEqual(beforeReservedFailure.client)
  expect(oldHostRestartedAfterReservedFailure).toBe(true)
  expect(existsSync(join(bundledCordis, 'package.json'))).toBe(true)
  const reservedFailureCalls = readFileSync(pnpmLog, 'utf8').trim().split('\n').slice(callsBeforeReservedFailure)
    .map(line => JSON.parse(line) as string[])
  expect(reservedFailureCalls.some(args => args.slice(args.indexOf('install')).join(' ')
    === 'install --frozen-lockfile --ignore-scripts')).toBe(true)
  expect(reservedFailureCalls.some(args => args.slice(args.indexOf('rebuild')).join(' ') === 'rebuild --pending')).toBe(true)

  const beforeRestartFailure = {
    host: readFileSync(hostProfilePath), client: readFileSync(clientProfilePath),
    manifest: readFileSync(join(profile, 'package.json')), lock: readFileSync(join(profile, 'pnpm-lock.yaml')),
  }
  const callsBeforeRestartFailure = readFileSync(pnpmLog, 'utf8').trim().split('\n').length
  let restartFailureCalls = 0
  const restoredHostRestartFailure = await manager.mutateNativeModules({ type: 'update', request: {
    expectedRevision: beforeUnsupported.inventory.revision, packageName: '@fixture/host-update', version: '1.2.0',
  } }, {
    beforeChange: async () => {},
    afterChange: async () => {
      restartFailureCalls += 1
      throw new Error(restartFailureCalls === 1 ? 'Updated Host start failed' : 'Restored Host start failed')
    },
  }, ready)
  expect(restoredHostRestartFailure).toMatchObject({ status: 'recovery-required', error: { code: 'recovery-required' } })
  expect(restartFailureCalls).toBe(2)
  expect(readFileSync(hostProfilePath)).toEqual(beforeRestartFailure.host)
  expect(readFileSync(clientProfilePath)).toEqual(beforeRestartFailure.client)
  expect(readFileSync(join(profile, 'package.json'))).toEqual(beforeRestartFailure.manifest)
  expect(readFileSync(join(profile, 'pnpm-lock.yaml'))).toEqual(beforeRestartFailure.lock)
  expect(existsSync(join(profile, 'desktop-packages-pending'))).toBe(false)
  const restartFailureCallsLog = readFileSync(pnpmLog, 'utf8').trim().split('\n').slice(callsBeforeRestartFailure)
    .map(line => JSON.parse(line) as string[])
  expect(restartFailureCallsLog.some(args => args.slice(args.indexOf('install')).join(' ')
    === 'install --frozen-lockfile --ignore-scripts')).toBe(true)
  expect(restartFailureCallsLog.some(args => args.slice(args.indexOf('rebuild')).join(' ')
    === 'rebuild --pending')).toBe(true)

  const callsBeforeFailedRecovery = readFileSync(pnpmLog, 'utf8').trim().split('\n').length
  writeFileSync(join(root, 'native-pnpm-fail-recovery-install'), '')
  const failedRecovery = await manager.mutateNativeModules({ type: 'update', request: {
    expectedRevision: beforeUnsupported.inventory.revision, packageName: '@fixture/host-update', version: '1.2.0',
  } }, {
    beforeChange: async () => {},
    afterChange: async () => { throw new Error('Updated Host start failed') },
  }, ready)
  expect(failedRecovery).toMatchObject({ status: 'recovery-required', error: { code: 'recovery-required' } })
  expect(existsSync(join(profile, 'desktop-packages-pending'))).toBe(true)
  expect(readFileSync(join(profile, 'package.json'))).toEqual(manifestBeforeUnsupported)
  expect(readFileSync(join(profile, 'pnpm-lock.yaml'))).toEqual(lockBeforeUnsupported)
  const pnpmCalls = readFileSync(pnpmLog, 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as string[])
  const failedRecoveryCalls = pnpmCalls.slice(callsBeforeFailedRecovery)
  const failedInstallIndex = failedRecoveryCalls.findIndex(args => args.slice(args.indexOf('install')).join(' ')
    === 'install --frozen-lockfile --ignore-scripts')
  expect(failedInstallIndex).toBeGreaterThanOrEqual(0)
  expect(failedRecoveryCalls.slice(failedInstallIndex + 1).some(args => args.includes('rebuild'))).toBe(false)
}, 15_000)

it('restores reserved Host peer links before validating package mutations', async () => {
  const root = fixtureRoot()
  const { manager, profile } = prepareFixture(root)
  await manager.applyRelease()
  writeNativeProfile(profile, [...initialHostRows,
    { id: 'shared-peer-host', plugin: '@fixture/shared-peer-host' },
  ], initialClientRows)
  prepareNativePackages(profile)
  writeNativePackage(profile, '@fixture/shared-peer-host', ['host'], [], [], '1.0.0', [],
    "import '@deepseek-ai/cordis'\n", { '@deepseek-ai/cordis': '*' })

  const initial = await manager.listNativeModules(ready)
  expect(initial.status).toBe('listed')
  if (initial.status !== 'listed') return
  const installed = await manager.mutateNativeModules({ type: 'install', request: {
    expectedRevision: initial.inventory.revision, packageName: '@fixture/new-client', version: '1.0.0',
    installations: [{ target: 'client', id: brandString<NativeDesktopInstallationId>('new-client'),
      config: undefined, enabled: false }],
  } }, hooks({ stop: 0, start: 0 }), ready)
  expect(installed.status).toBe('applied')
}, 15_000)
