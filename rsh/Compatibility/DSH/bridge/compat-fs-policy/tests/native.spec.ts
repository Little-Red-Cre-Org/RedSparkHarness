/** Legacy policy decisions forwarded into native filesystem events. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as compatRuntimePlugin } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type { CompatDshRuntime } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { plugin as nativePolicy } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin, validateLegacyPolicyManifest } from '../src/native.ts'

it('rejects changed legacy declarations, configuration and duplicate policy authority', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../../Modules/Official/fs/fs-observation-policy/package.json', import.meta.url), 'utf8')) as Parameters<typeof validateLegacyPolicyManifest>[0]
  expect(() => { validateLegacyPolicyManifest(manifest) }).not.toThrow()
  expect(() => { validateLegacyPolicyManifest({ ...manifest, dsh: { ...manifest.dsh, runtime: { apiVersion: 2, role: 'policy', capability: 'filesystem' } } }) })
    .toThrow('unsupported')
  const scope = new NativeScope()
  expect(() => plugin.resolve({ ignored: true })).toThrow('configuration must be empty')
  expect(() => resolveInstallation([
    { plugin, scope, config: undefined }, { plugin: nativePolicy, scope, config: undefined },
    { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host')).toThrow('duplicate')
})

it('preserves observations, releases listeners on unload, and shows policy short-circuits by design', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-fs-policy-'))
  const scope = new NativeScope()
  let filesystem: FileSystemOperations | undefined
  let runtime: CompatDshRuntime | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'consumer', targets: ['host'], requires: ['fs'], provides: [],
    resolve: () => (context) => { filesystem = context.require('fs') },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'compat-runtime-capture', targets: ['host'], requires: ['compatDshRuntime'], provides: [],
    resolve: () => (context) => { runtime = context.require('compatDshRuntime') },
  }
  const selectedPolicy = { plugin, scope, config: undefined }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: directory } },
    selectedPolicy,
    { plugin: capture, scope, config: undefined },
    { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (filesystem === undefined) throw new Error('missing native filesystem')
    const target = await filesystem.resolve('file.txt')
    const first = { agent: { session: {} } }
    const second = { agent: { session: {} } }
    expect(await host.events.waterfall(scope, 'fs/write-intent', () => undefined, target, first)).toEqual({ kind: 'createIfAbsent' })
    await writeFile(join(directory, 'file.txt'), 'before')
    const info = await filesystem.stat(target)
    if (info === undefined) throw new Error('missing file')
    host.events.emit(scope, 'fs/observed', target, { kind: 'present', version: info.version }, first)
    if (runtime === undefined) throw new Error('missing compatibility runtime')
    const legacy = runtime.context
    const syncTrace: string[] = []
    const legacyObserved = legacy.on('fs/observed', () => { syncTrace.push('cordis') })
    const nativeObserved = host.events.on(scope, 'fs/observed', () => { syncTrace.push('native') })
    host.events.emit(scope, 'fs/observed', target, { kind: 'present', version: info.version }, first)
    expect(syncTrace).toEqual(['cordis', 'native'])
    const syncFailure = new Error('Cordis observation listener failed')
    const failingObserved = legacy.on('fs/observed', () => { throw syncFailure }, { prepend: true })
    expect(() => { host.events.emit(scope, 'fs/observed', target, { kind: 'present', version: info.version }, first) })
      .toThrow(syncFailure)
    failingObserved()
    legacyObserved()
    await nativeObserved()
    await expect(host.events.waterfall(scope, 'fs/edit-intent', () => undefined, target, second))
      .rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    const delegation: string[] = []
    const policyShortCircuitOuter = legacy.on('fs/write-intent', async (_target, _actor, next) => {
      delegation.push('Cordis outer')
      return next()
    }, { prepend: true })
    let callerTerminalCalled = false
    const intent = await host.events.waterfall(scope, 'fs/write-intent', () => {
      callerTerminalCalled = true
      return undefined
    }, target, first)
    policyShortCircuitOuter()
    expect(intent).toEqual({ kind: 'replaceIfVersion', version: info.version })
    expect(delegation).toEqual(['Cordis outer'])
    expect(callerTerminalCalled).toBe(false)
    const rejection = new Error('Cordis waterfall rejected')
    const rejectLegacy = legacy.on('fs/write-intent', async () => { throw rejection }, { prepend: true })
    await expect(host.events.waterfall(scope, 'fs/write-intent', () => undefined, target, first)).rejects.toBe(rejection)
    rejectLegacy()
    await writeFile(join(directory, 'file.txt'), 'changed')
    await expect(filesystem.writeText(target, 'denied', intent)).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await readFile(join(directory, 'file.txt'), 'utf8')).toBe('changed')
    await host.remove(selectedPolicy)
    expect(await host.events.waterfall(scope, 'fs/write-intent', () => undefined, target, first)).toBeUndefined()
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
