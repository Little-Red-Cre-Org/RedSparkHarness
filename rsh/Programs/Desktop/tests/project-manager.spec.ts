import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@redspark/rsh-session'
import type { SessionEvent, SessionHeader } from '@redspark/rsh-session'
import { inspectSessionRootCompression } from '@redspark/rsh-session-persistence-jsonl/native-inspection'
import { JsonlSessionBackend, type JsonlCompression } from '@redspark/rsh-session-persistence-jsonl/native'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from '../src/project-manager.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
const releaseWorkers: Array<() => Promise<void>> = []
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-test-'))
  roots.push(root)
  return root
}
function writeFakePnpm(root: string): string {
  const path = join(root, 'pnpm.mjs')
  writeFileSync(path, `
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const project = process.cwd()
const command = args.find(value => ['install', 'add', 'remove', 'rebuild'].includes(value))
appendFileSync(${JSON.stringify(join(root, 'pnpm-log.jsonl'))}, JSON.stringify({args, registry: process.env.NPM_CONFIG_REGISTRY}) + '\\n')
if (command !== 'rebuild') {
  const manifestPath = join(project, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (command === 'add') {
    const spec = args[args.indexOf(command) + 1]
    const index = spec.lastIndexOf('@')
    const name = index > 0 ? spec.slice(0, index) : spec
    manifest.dependencies[name] = index > 0 ? spec.slice(index + 1) : '1.0.0'
  }
  if (command === 'remove') delete manifest.dependencies[args[args.indexOf(command) + 1]]
  writeFileSync(manifestPath, JSON.stringify(manifest))
  rmSync(join(project, 'node_modules'), { recursive: true, force: true })
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const packageRoot = join(project, 'node_modules', name)
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({name, version,
      peerDependencies: {'@redspark/cordis': '^1.0.0'}, dsh: {bundle: {patch: './bundle.yml'}}}))
    writeFileSync(join(packageRoot, 'bundle.yml'), '[]\\n')
  }
  writeFileSync(join(project, 'pnpm-lock.yaml'), JSON.stringify(manifest.dependencies))
}
`)
  return path
}
function setupNative(): { root: string; manager: DesktopProjectManager } {
  const root = temporaryRoot()
  const dsh = join(root, 'resources', 'dsh')
  runtimeFixture(dsh)
  vi.stubEnv('RSH_HOME', join(root, '.dsh'))
  return { root, manager: new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')),
    { node: process.execPath, pnpm: writeFakePnpm(root), dsh }) }
}
function hooks(overrides: Partial<DesktopProjectHooks> = {}): DesktopProjectHooks {
  return { beforeChange: async () => {}, afterChange: async () => {}, ...overrides }
}
function calls(root: string): { args: string[]; registry: string }[] {
  const path = join(root, 'pnpm-log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { args: string[]; registry: string }) : []
}
interface StoredSessionFixture {
  readonly id: ReturnType<typeof SessionId>
  readonly events: SessionEvent[]
  readonly path: string
  readonly bytes: Buffer
}
async function writeSession(root: string, compression: JsonlCompression, value: string): Promise<StoredSessionFixture> {
  const id = SessionId(value)
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 1000, isSeeded: false }
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const backend = new JsonlSessionBackend({ root, compression })
  try {
    const handle = await backend.create(header)
    try { await handle.append(events) } finally { await handle.close() }
  } finally {
    await backend.close()
  }
  const directory = join(root, '_no-cwd', value)
  const suffix = compression === 'zstd' ? '.jsonl.zstd' : '.jsonl'
  const log = readdirSync(directory).find(name => name.endsWith(suffix))
  if (log === undefined) throw new Error(`${compression} Session fixture did not write a committed generation`)
  const path = join(directory, log)
  return { id, events, path, bytes: readFileSync(path) }
}
async function expectSessionReadable(root: string, compression: JsonlCompression, fixture: StoredSessionFixture): Promise<void> {
  const backend = new JsonlSessionBackend({ root, compression })
  try {
    const handle = await backend.open(fixture.id, 'read')
    try { expect((await handle.read()).events).toEqual(fixture.events) } finally { await handle.close() }
  } finally {
    await backend.close()
  }
}
function nativeStorageConfig(profile: string): { root: string; compression?: JsonlCompression } {
  const document = JSON.parse(readFileSync(join(profile, 'rsh.profile.json'), 'utf8')) as {
    installations: Array<{ plugin: string; config?: unknown }>
  }
  const storage = document.installations.find(row => row.plugin === '@redspark/rsh-session-persistence-jsonl')
  if (storage === undefined || typeof storage.config !== 'object' || storage.config === null
    || Array.isArray(storage.config) || typeof (storage.config as { root?: unknown }).root !== 'string') {
    throw new Error('Native Desktop profile has no JSONL storage configuration')
  }
  const config = storage.config as { root: string; compression?: JsonlCompression }
  return config
}
afterEach(async () => {
  const cleanups = releaseWorkers.splice(0)
  const directories = roots.splice(0)
  const results = await Promise.allSettled(cleanups.map(cleanup => cleanup()))
  for (const root of directories) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  const failures: unknown[] = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length > 0) throw new AggregateError(failures, 'desktop worker cleanup failed')
})

it.each(['fresh', 'old-template', 'custom-profile', 'legacy-without-compat'] as const)(
  'keeps Desktop runtime selection explicit for %s', async (scenario) => {
    const { root, manager } = setupNative()
    const profile = manager.paths.profile
    const packagePath = join(profile, 'package.json')
    const workspacePath = join(profile, 'pnpm-workspace.yaml')
    let history: StoredSessionFixture | undefined
    if (scenario !== 'fresh') mkdirSync(profile, { recursive: true })
    if (scenario === 'old-template') {
      writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
        name: '@redspark/rsh-desktop-runtime', private: true, version: '0.0.0', dependencies: {},
        dsh: { profile: { bundles: ['@redspark/rsh-base', '@redspark/rsh-web-app'] } },
      }, undefined, 2)}\n`)
    }
    if (scenario === 'old-template') {
      const home = dirname(manager.paths.root)
      const wrongHome = join(root, 'wrong-home')
      const settingsPath = join(home, 'settings.yaml')
      mkdirSync(home, { recursive: true })
      mkdirSync(wrongHome, { recursive: true })
      history = await writeSession(join(home, 'sessions'), 'zstd', 'desktop-compression-upgrade')
      mkdirSync(join(profile, 'node_modules'), { recursive: true })
      writeFileSync(join(profile, '.env'), 'DESKTOP_TEST_SETTING=preserved\n')
      writeFileSync(settingsPath, 'locale:\n  preference: fr\n')
      writeFileSync(join(wrongHome, 'settings.yaml'), 'locale:\n  preference: zh\n')
      vi.stubEnv('RSH_HOME', wrongHome)
      const originalPackage = readFileSync(packagePath)
      const originalEnv = readFileSync(join(profile, '.env'))
      await expect(manager.applyRelease()).rejects.toThrow(/locale.preference="fr" must be en, zh, or system/u)
      expect(readFileSync(packagePath)).toEqual(originalPackage)
      expect(readFileSync(join(profile, '.env'))).toEqual(originalEnv)
      expect(existsSync(workspacePath)).toBe(false)
      expect(existsSync(join(profile, 'rsh.profile.json'))).toBe(false)
      expect(existsSync(join(profile, 'rsh.client.json'))).toBe(false)
      expect(readdirSync(join(profile, 'node_modules'))).toEqual([])
      unlinkSync(settingsPath)
    }
    if (scenario === 'custom-profile') {
      const patchPath = join(profile, 'cordis.patch.yml')
      writeFileSync(patchPath, '[]\n')
      const patchBefore = readFileSync(patchPath)
      await expect(manager.applyRelease()).rejects.toThrow(/existing profile without a Desktop manifest was not changed/u)
      expect(readFileSync(patchPath)).toEqual(patchBefore)
      expect(existsSync(packagePath)).toBe(false)
      writeFileSync(packagePath, `${JSON.stringify({
        name: '@redspark/rsh-desktop-runtime', private: true, version: '0.0.0', dependencies: {},
        dsh: { profile: { bundles: ['@redspark/rsh-base', '@redspark/rsh-web-app'] } },
      }, undefined, 2)}\n`)
      writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    }
    if (scenario === 'legacy-without-compat') {
      writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
        name: '@redspark/rsh-desktop-runtime', private: true, version: '0.0.0', dependencies: {},
        dsh: { profile: { runtime: 'legacy', bundles: ['@redspark/rsh-base'] } },
      }, undefined, 2)}\n`)
      writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    }
    const before = scenario === 'custom-profile' || scenario === 'legacy-without-compat'
      ? [readFileSync(packagePath), readFileSync(workspacePath)] : undefined

    if (scenario === 'fresh' || scenario === 'old-template') {
      await expect(manager.applyRelease()).resolves.toBe(true)
      expect(JSON.parse(readFileSync(packagePath, 'utf8'))).toMatchObject({
        dsh: { profile: { runtime: 'native', config: 'rsh.profile.json', configReload: 'startup' } },
      })
      const storage = nativeStorageConfig(profile)
      expect(storage.root).toBe(join(dirname(manager.paths.root), 'sessions'))
      expect(storage.compression).toBe(scenario === 'fresh' ? 'none' : 'zstd')
      expect(readFileSync(join(profile, 'rsh.profile.json'), 'utf8')).not.toContain('"id": "app"')
      expect(existsSync(join(profile, 'node_modules', '@redspark', 'cordis'))).toBe(false)
      if (scenario === 'old-template') {
        if (history === undefined) throw new Error('old-template Session fixture was not created')
        if (storage.compression === undefined) throw new Error('Native Desktop profile omitted Session compression')
        await expectSessionReadable(storage.root, storage.compression, history)
        expect(readFileSync(history.path)).toEqual(history.bytes)
        const deletionBackend = new JsonlSessionBackend({ root: storage.root, compression: 'zstd' })
        try {
          const receipt = await deletionBackend.deletions.delete(history.id)
          expect(await inspectSessionRootCompression(storage.root)).toBe('zstd')
          expect(await deletionBackend.deletions.list()).toEqual([receipt])
          const retained = join(storage.root, '.rsh-session-trash', receipt.id, 'payload', basename(history.path))
          expect(readFileSync(retained)).toEqual(history.bytes)
          await deletionBackend.deletions.restore(receipt.id)
          await expectSessionReadable(storage.root, storage.compression, history)
        } finally { await deletionBackend.close() }
        expect(readFileSync(join(profile, '.env'), 'utf8')).toBe('DESKTOP_TEST_SETTING=preserved\n')
        const client = JSON.parse(readFileSync(join(profile, 'rsh.client.json'), 'utf8')) as {
          installations: { plugin: string; config?: unknown }[]
        }
        expect(client.installations.find(row => row.plugin === '@redspark/rsh-client-locale')?.config).toBeUndefined()
      }
      expect(calls(root)).toEqual([])
      return
    }

    const message = scenario === 'custom-profile'
      ? /custom Cordis profiles are retired and were not changed/u
      : /Cordis compatibility assembly is retired/u
    await expect(manager.applyRelease()).rejects.toThrow(message)
    expect(readFileSync(packagePath)).toEqual(before?.[0])
    expect(readFileSync(workspacePath)).toEqual(before?.[1])
    expect(existsSync(join(profile, 'desktop-runtime-state.json'))).toBe(false)
    expect(calls(root)).toEqual([])
  },
)

it('refuses a mixed Session root before reset stops the Host or changes profile files and links', async () => {
  const { root, manager } = setupNative()
  await manager.applyRelease()
  const sessions = join(dirname(manager.paths.root), 'sessions')
  const compressed = await writeSession(sessions, 'zstd', 'desktop-mixed-zstd')
  const plainSource = await writeSession(join(root, 'plain-session-root'), 'none', 'desktop-mixed-plain')
  const plainPath = join(sessions, '_no-cwd', 'desktop-mixed-plain', basename(plainSource.path))
  mkdirSync(dirname(plainPath), { recursive: true })
  copyFileSync(plainSource.path, plainPath)
  const profile = manager.paths.profile
  const files = ['package.json', 'pnpm-workspace.yaml', 'rsh.profile.json', 'rsh.client.json', 'desktop-runtime-state.json']
  const profileBytes = new Map(files.filter(name => existsSync(join(profile, name)))
    .map(name => [name, readFileSync(join(profile, name))]))
  const dependencyLinks = join(profile, 'node_modules', '@redspark')
  const links = readdirSync(dependencyLinks).map(name => [name, realpathSync(join(dependencyLinks, name))])
  const beforeChange = vi.fn(async () => {})

  await expect(manager.resetConfiguration(hooks({ beforeChange }))).rejects.toThrow(/mixed compression/u)

  expect(beforeChange).not.toHaveBeenCalled()
  expect(new Map(files.filter(name => existsSync(join(profile, name)))
    .map(name => [name, readFileSync(join(profile, name))]))).toEqual(profileBytes)
  expect(readdirSync(dependencyLinks).map(name => [name, realpathSync(join(dependencyLinks, name))])).toEqual(links)
  expect(readFileSync(compressed.path)).toEqual(compressed.bytes)
  expect(readFileSync(plainPath)).toEqual(plainSource.bytes)
  expect(calls(root)).toEqual([])
})

it('reports damaged application metadata as a reinstall failure', async () => {
  const { manager } = setupNative()
  writeFileSync(join(manager.runtime.dsh, 'desktop-runtime.json'), '{broken')
  await expect(manager.applyRelease()).rejects.toThrow()
  expect(manager.canRecoverProfile()).toBe(false)
})

it('refuses an unrecognized profile directory without changing its files', async () => {
  const { manager } = setupNative()
  mkdirSync(manager.paths.profile, { recursive: true })
  writeFileSync(join(manager.paths.profile, '.DS_Store'), 'metadata')
  writeFileSync(join(manager.paths.profile, 'user-file'), 'retain')
  await expect(manager.applyRelease()).rejects.toThrow(/existing profile without a Desktop manifest/u)
  expect(readFileSync(join(manager.paths.profile, '.DS_Store'), 'utf8')).toBe('metadata')
  expect(readFileSync(join(manager.paths.profile, 'user-file'), 'utf8')).toBe('retain')
  expect(existsSync(join(manager.paths.profile, 'package.json'))).toBe(false)
})

it('retries a failed rebuild after a runtime change across manager instances', async () => {
  const { root, manager } = setupNative()
  await manager.applyRelease()
  const manifest = JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  manifest.dependencies.plugin = '1.0.0'
  writeFileSync(join(manager.paths.profile, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  const dsh = join(root, 'new-node')
  runtimeFixture(dsh, '1.1.0', '24.18.0')
  const failing = join(root, 'fail-rebuild.mjs')
  writeFileSync(failing, `await import(${JSON.stringify(pathToFileURL(manager.runtime.pnpm).href)}); if (process.argv.includes('rebuild')) process.exitCode = 1`)
  const worker = new DesktopProjectManager(manager.paths, { ...manager.runtime, dsh, pnpm: failing })
  await expect(worker.applyRelease()).rejects.toThrow('pnpm exited with 1')
  expect(() => { worker.assertProfileRuntime(worker.paths.profile) }).toThrow('package preparation is incomplete')
  const count = calls(root).length
  const retry = new DesktopProjectManager(manager.paths, { ...manager.runtime, dsh })
  await expect(retry.applyRelease()).resolves.toBe(true)
  expect(calls(root).slice(count).map(call => call.args.find(arg => !arg.startsWith('--config.')))).toEqual(['install', 'rebuild'])
  await expect(retry.applyRelease()).resolves.toBe(false)
  expect(calls(root)).toHaveLength(count + 2)
})

it('initializes and restarts offline without executing pnpm', async () => {
  const { root, manager } = setupNative()
  await expect(manager.applyRelease()).resolves.toBe(true)
  await expect(manager.applyRelease()).resolves.toBe(false)
  expect(calls(root)).toEqual([])
  expect(existsSync(manager.paths.pnpm.store)).toBe(false)
  expect(JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8'))).toMatchObject({ dependencies: {} })
})

it('repairs a removed managed link without running pnpm', async () => {
  const { root, manager } = setupNative()
  await manager.applyRelease()
  unlinkSync(join(manager.paths.profile, 'node_modules/@redspark/rsh-desktop-host'))
  await expect(manager.applyRelease()).resolves.toBe(true)
  expect(calls(root)).toEqual([])
})

it.skipIf(process.platform !== 'win32')('reuses the profile when the launch path changes only Windows letter casing', async () => {
  const { manager } = setupNative()
  await manager.applyRelease()
  const relaunched = new DesktopProjectManager(manager.paths, { ...manager.runtime, dsh: manager.runtime.dsh.toUpperCase() })
  await expect(relaunched.applyRelease()).resolves.toBe(false)
})

it.each(['changed', 'same-size', 'extra', 'missing'])('starts and reuses a profile without checking %s runtime bytes', async (operation) => {
  const { root, manager } = setupNative()
  if (operation === 'changed') writeFileSync(join(manager.runtime.dsh, 'package.json'), '{}')
  if (operation === 'same-size') writeFileSync(join(manager.runtime.dsh, 'package.json'), '{"type":"Module"}\n')
  if (operation === 'extra') writeFileSync(join(manager.runtime.dsh, 'extra'), '')
  if (operation === 'missing') unlinkSync(join(manager.runtime.dsh, 'package.json'))
  await expect(manager.applyRelease()).resolves.toBe(true)
  const relaunched = new DesktopProjectManager(manager.paths, manager.runtime)
  await expect(relaunched.applyRelease()).resolves.toBe(false)
  expect(existsSync(manager.paths.profile)).toBe(true)
  expect(calls(root)).toEqual([])
})

it('resets the entire profile without backups while retaining its lock and shared data', async () => {
  const { root, manager } = setupNative()
  await manager.applyRelease()
  const history = await writeSession(join(dirname(manager.paths.root), 'sessions'), 'zstd', 'desktop-reset-preserve')
  const profile = manager.paths.profile
  expect(manager.paths.lock).toBe(join(profile, 'lock'))
  const task = join(root, '.dsh', 'task-sentinel')
  const homeEnvironment = join(root, '.dsh', '.env')
  writeFileSync(homeEnvironment, 'HOME_SETTING=retained')
  writeFileSync(task, 'retained task')
  writeFileSync(join(profile, 'desktop-runtime-state.json'), '{broken')
  writeFileSync(join(profile, 'cordis.patch.yml'), ': broken')
  writeFileSync(join(profile, '.env'), 'NODE_OPTIONS=--bad')
  mkdirSync(join(profile, '.extra'))
  writeFileSync(join(profile, '.extra', 'custom-file'), 'remove')
  const shared = join(root, 'shared-data')
  mkdirSync(shared)
  writeFileSync(join(shared, 'sentinel'), 'preserve')
  symlinkSync(shared, join(profile, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir')
  await manager.resetConfiguration(hooks({
    beforeChange: async () => { expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe(': broken') },
    afterChange: async () => {
      manager.assertProfileRuntime(profile)
      expect(readFileSync(manager.paths.lock, 'utf8').trim()).toBe(String(process.pid))
      await expect(manager.applyRelease()).rejects.toThrow('another package transaction is active')
    },
  }))
  expect(existsSync(join(profile, 'cordis.patch.yml'))).toBe(false)
  expect(existsSync(join(profile, '.env'))).toBe(false)
  expect(existsSync(join(profile, '.extra'))).toBe(false)
  expect(existsSync(join(profile, 'external-link'))).toBe(false)
  expect(readFileSync(join(shared, 'sentinel'), 'utf8')).toBe('preserve')
  expect(readFileSync(task, 'utf8')).toBe('retained task')
  expect(readFileSync(homeEnvironment, 'utf8')).toBe('HOME_SETTING=retained')
  const storage = nativeStorageConfig(profile)
  expect(storage.compression).toBe('zstd')
  if (storage.compression === undefined) throw new Error('reset Native profile omitted Session compression')
  await expectSessionReadable(storage.root, storage.compression, history)
  expect(readFileSync(history.path)).toEqual(history.bytes)
  expect(readdirSync(profile).some(name => name.includes('backup'))).toBe(false)
  expect(calls(root)).toEqual([])
  await expect(manager.applyRelease()).resolves.toBe(false)
  expect(existsSync(homeEnvironment)).toBe(true)
})

it('reinstalls the locked package graph when bundled Node changes', async () => {
  const { root, manager } = setupNative()
  await manager.applyRelease()
  const manifest = JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  manifest.dependencies.plugin = '1.0.0'
  writeFileSync(join(manager.paths.profile, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  const dsh = join(root, 'new-node')
  runtimeFixture(dsh, '1.1.0', '24.18.0')
  const next = new DesktopProjectManager(manager.paths, { ...manager.runtime, dsh })
  await next.applyRelease()
  expect(calls(root).map(call => call.args.filter(arg => !arg.startsWith('--config.')))).toEqual([
    ['install', '--frozen-lockfile', '--ignore-scripts'], ['rebuild', '--pending'],
  ])
  await expect(next.applyRelease()).resolves.toBe(false)
})
