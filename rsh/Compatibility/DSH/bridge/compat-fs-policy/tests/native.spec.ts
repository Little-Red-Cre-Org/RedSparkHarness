/** Legacy policy decisions forwarded into native filesystem events. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { plugin as nativePolicy } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin, validateLegacyPolicyManifest } from '../src/native.ts'

it('rejects changed legacy declarations, configuration and duplicate policy authority', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../../Modules/Official/fs/fs-observation-policy/package.json', import.meta.url), 'utf8')) as Parameters<typeof validateLegacyPolicyManifest>[0]
  expect(() => { validateLegacyPolicyManifest(manifest) }).not.toThrow()
  expect(() => { validateLegacyPolicyManifest({ dsh: { runtime: { apiVersion: 2, role: 'policy', capability: 'filesystem' } } }) })
    .toThrow('unsupported')
  const scope = new NativeScope()
  expect(() => resolveInstallation([{ plugin, scope, config: { ignored: true } }], 'host')).toThrow('configuration must be empty')
  expect(() => resolveInstallation([
    { plugin, scope, config: undefined }, { plugin: nativePolicy, scope, config: undefined },
  ], 'host')).toThrow('duplicate')
})

it('preserves per-session observations and releases only its own listeners on unload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-fs-policy-'))
  const scope = new NativeScope()
  let filesystem: FileSystemOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'consumer', targets: ['host'], requires: ['fs'], provides: [],
    resolve: () => (context) => { filesystem = context.require('fs') },
  }
  const selectedPolicy = { plugin, scope, config: undefined }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: directory } },
    selectedPolicy,
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
    await expect(host.events.waterfall(scope, 'fs/edit-intent', () => undefined, target, second))
      .rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    const intent = await host.events.waterfall(scope, 'fs/write-intent', () => undefined, target, first)
    expect(intent).toEqual({ kind: 'replaceIfVersion', version: info.version })
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
