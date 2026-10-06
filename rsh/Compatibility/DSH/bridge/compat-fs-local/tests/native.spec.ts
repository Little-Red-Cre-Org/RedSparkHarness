/** Cordis filesystem Provider serving an unchanged native Consumer. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { CompatDshRuntime } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import { plugin as compatRuntimePlugin } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin, validateLegacyFilesystemManifest } from '../src/native.ts'

it('checks the selected legacy declaration and configuration before activation', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../../Modules/Official/fs/fs-local/package.json', import.meta.url), 'utf8')) as Parameters<typeof validateLegacyFilesystemManifest>[0]
  expect(() => { validateLegacyFilesystemManifest(manifest) }).not.toThrow()
  expect(() => { validateLegacyFilesystemManifest({ ...manifest, version: '0.1.6' }) }).toThrow('unsupported @deepseek-ai/dsh-fs-local version')
  expect(() => { validateLegacyFilesystemManifest({ ...manifest, name: '@deepseek-ai/other' }) }).toThrow('package name')
  expect(() => { validateLegacyFilesystemManifest({ ...manifest, dsh: { ...manifest.dsh, runtime: { apiVersion: 2, role: 'provider', capability: 'filesystem' } } }) })
    .toThrow('unsupported')
  expect(() => plugin.resolve({ unknown: true })).toThrow('fs-local:')
})

it('serves an unchanged native Consumer and rejects a duplicate Provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-fs-local-'))
  const updatedDirectory = join(directory, 'updated')
  await mkdir(updatedDirectory)
  const scope = new NativeScope()
  let filesystem: FileSystemOperations | undefined
  let runtime: CompatDshRuntime | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'unchanged-consumer', targets: ['host'], requires: ['fs', 'compatDshRuntime'], provides: [],
    resolve: () => (context) => { filesystem = context.require('fs'); runtime = context.require('compatDshRuntime') },
  }
  const legacy = { plugin, scope, config: { cwd: directory } }
  const compatRuntime = { plugin: compatRuntimePlugin, scope, config: undefined }
  const host = new NativeHost(resolveInstallation([{ plugin: consumer, scope, config: undefined }, legacy, compatRuntime], 'host'))
  try {
    expect(() => resolveInstallation([legacy, { plugin: localFilesystemPlugin, scope, config: { cwd: directory } }, compatRuntime], 'host'))
      .toThrow('duplicate')
    await host.start()
    if (!(filesystem instanceof LocalFileSystem)) throw new Error('legacy Provider did not reach Consumer')
    const target = await filesystem.resolve('legacy.txt')
    await filesystem.writeText(target, 'from Cordis', { kind: 'createIfAbsent' })
    expect(await readFile(join(directory, 'legacy.txt'), 'utf8')).toBe('from Cordis')
    if (runtime === undefined) throw new Error('missing compatibility runtime')
    await runtime.update('@deepseek-ai/dsh-fs-local', { cwd: updatedDirectory })
    if (!(filesystem instanceof LocalFileSystem)) throw new Error('missing current Cordis LocalFileSystem')
    expect(filesystem.config.cwd).toBe(updatedDirectory)
    const updatedTarget = await filesystem.resolve('updated.txt')
    await filesystem.writeText(updatedTarget, 'after update', { kind: 'createIfAbsent' })
    expect(await readFile(join(updatedDirectory, 'updated.txt'), 'utf8')).toBe('after update')
    await runtime.remove('@deepseek-ai/dsh-fs-local')
    expect(() => filesystem?.resolve('after-remove.txt')).toThrow('Cordis service fs is unavailable')
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('awaits legacy filesystem disposal when an admitted write is cancelled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-fs-stop-'))
  const scope = new NativeScope()
  let filesystem: FileSystemOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'consumer', targets: ['host'], requires: ['fs'], provides: [],
    resolve: () => (context) => { filesystem = context.require('fs') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined }, { plugin, scope, config: { cwd: directory } },
    { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host'))
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  try {
    await host.start()
    if (!(filesystem instanceof LocalFileSystem)) throw new Error('missing legacy filesystem')
    filesystem.internals.inspectTemp = async () => { entered.resolve(undefined); await release.promise }
    const target = await filesystem.resolve('cancelled.txt')
    const write = filesystem.writeText(target, 'not committed', { kind: 'createIfAbsent' })
    const rejection = expect(write).rejects.toMatchObject({ code: 'FS_ABORTED' })
    await entered.promise
    let stopped = false
    const stopping = host.stop().then(() => { stopped = true })
    expect(stopped).toBe(false)
    release.resolve(undefined)
    await rejection
    await stopping
    await expect(readFile(join(directory, 'cancelled.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    release.resolve(undefined)
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
