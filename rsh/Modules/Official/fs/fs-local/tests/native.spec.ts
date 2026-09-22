/** Real native host composition with local storage and owned shutdown. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { LocalFileSystemBackend, resolveLocalFilesystemConfig } from '../src/backend.ts'
import { localFilesystemPlugin, plugin } from '../src/native.ts'

it('accepts the published native entry declaration before planning', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dsh: { native: unknown }
    exports: Record<string, unknown>
  }
  const metadata = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports)))
  expect(validateNativePluginEntry(plugin, metadata)).toBe(localFilesystemPlugin)
})

async function mount(directory: string) {
  const scope = new NativeScope()
  let service: FileSystemOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'filesystem consumer', targets: ['host'], requires: ['fs'], provides: [],
    resolve: () => (context) => { service = context.require('fs') },
  }
  const provider = { plugin: localFilesystemPlugin, scope, config: { cwd: directory } }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: {} }, provider,
  ], 'host'))
  await host.start()
  if (!(service instanceof LocalFileSystemBackend)) throw new Error('expected explicitly selected local provider')
  return { host, service, provider }
}

it('resolves explicit native configuration before activation and rejects unsupported fields', () => {
  const config = resolveLocalFilesystemConfig({ cwd: '.', diffBasisMaxBytes: 1024 })
  expect(isAbsolute(config.cwd)).toBe(true)
  expect(Object.isFrozen(config)).toBe(true)
  expect(resolveLocalFilesystemConfig(undefined).diffBasisMaxBytes).toBe(10 * 1024 * 1024)
  for (const input of [null, [], 'path', { cwd: 3 }, { diffBasisMaxBytes: '100' }, { diffBasisMaxBytes: 0 }, { ignored: true }]) {
    expect(() => resolveInstallation([{ plugin: localFilesystemPlugin, scope: new NativeScope(), config: input }], 'host')).toThrow('fs-local:')
  }
})

it('cancels a staged native write and waits for its staging directory to be removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-fs-stop-'))
  const { host, service } = await mount(directory)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  service.internals.inspectTemp = async () => { entered.resolve(undefined); await release.promise }
  let write: Promise<unknown> | undefined
  try {
    const target = await service.resolve('cancelled.txt')
    write = service.writeText(target, 'must not publish', { kind: 'createIfAbsent' })
    const rejected = expect(write).rejects.toMatchObject({ code: 'FS_ABORTED' })
    await entered.promise
    let released = false
    const stopping = host.stop().then(() => released)
    await expect(service.resolve('late.txt')).rejects.toMatchObject({ code: 'FS_ABORTED' })
    released = true
    release.resolve(undefined)
    expect(await stopping).toBe(true)
    await rejected
    await expect(readFile(join(directory, 'cancelled.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(directory)).toEqual([])
  } finally {
    release.resolve(undefined)
    await Promise.allSettled([write, host.stop()])
    await rm(directory, { recursive: true, force: true })
  }
})

it('closes paused and unstarted text streams when the provider is removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-fs-stream-'))
  const { host, service, provider } = await mount(directory)
  try {
    await writeFile(join(directory, 'large.txt'), 'x'.repeat(256 * 1024))
    const target = await service.resolve('large.txt')
    const active = (await service.streamText(target))[Symbol.asyncIterator]()
    const unstarted = (await service.streamText(target))[Symbol.asyncIterator]()
    expect((await active.next()).done).toBe(false)
    await host.remove(provider)
    expect((await active.next()).done).toBe(true)
    expect((await unstarted.next()).done).toBe(true)
    await expect(service.readText(target)).rejects.toMatchObject({ code: 'FS_ABORTED' })
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('isolates two native filesystem providers without constructing a fallback provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-fs-scopes-'))
  const services: FileSystemOperations[] = []
  const scopes = [new NativeScope(), new NativeScope()]
  const requests = scopes.flatMap((scope, index) => {
    const consumer: NativePlugin = {
      apiVersion: 1, name: `consumer-${index}`, targets: ['host'], requires: ['fs'], provides: [],
      resolve: () => (context) => { services[index] = context.require('fs') },
    }
    return [
      { plugin: consumer, scope, config: {} },
      { plugin: localFilesystemPlugin, scope, config: { cwd: join(directory, String(index)) } },
    ]
  })
  const host = new NativeHost(resolveInstallation(requests, 'host'))
  try {
    await host.start()
    await Promise.all(services.map(async (service, index) => {
      const target = await service.resolve('same.txt')
      await service.writeText(target, String(index), { kind: 'createIfAbsent' })
      expect(await service.readText(target)).toBe(String(index))
    }))
    expect(await readFile(join(directory, '0', 'same.txt'), 'utf8')).toBe('0')
    expect(await readFile(join(directory, '1', 'same.txt'), 'utf8')).toBe('1')
    const missing = requests[0]
    if (missing === undefined) throw new Error('missing fixture consumer')
    expect(() => resolveInstallation([missing], 'host')).toThrow('missing fs')
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('keeps the same consumer when a controlled filesystem provider replaces the local plugin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-fs-replace-'))
  const scope = new NativeScope()
  let service: FileSystemOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'unchanged-consumer', targets: ['host'], requires: ['fs'], provides: [],
    resolve: () => (context) => { service = context.require('fs') },
  }
  const backend = new LocalFileSystemBackend(resolveLocalFilesystemConfig({ cwd: directory }))
  const controlledProvider: NativePlugin = {
    apiVersion: 1, name: 'controlled-provider', targets: ['host'], requires: [], provides: ['fs'],
    resolve: () => (context) => {
      context.provide('fs', backend)
      context.own(() => backend.close())
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: controlledProvider, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (service === undefined) throw new Error('controlled provider did not reach consumer')
    expect(service).toBe(backend)
    const target = await service.resolve('alternate.txt')
    await service.writeText(target, 'injected', { kind: 'createIfAbsent' })
    expect(await readFile(join(directory, 'alternate.txt'), 'utf8')).toBe('injected')
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
