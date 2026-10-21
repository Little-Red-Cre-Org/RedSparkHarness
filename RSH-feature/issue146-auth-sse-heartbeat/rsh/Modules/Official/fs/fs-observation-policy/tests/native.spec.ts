/** Native observation decisions against the same filesystem used by legacy tools. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { plugin } from '../src/native.ts'

it('publishes the same native policy declaration as its package manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dsh: { native: unknown }
    exports: Record<string, unknown>
  }
  const entry = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports)))
  expect(validateNativePluginEntry(plugin, entry)).toBe(plugin)
})

it('isolates observations by session and rejects stale edits without changing the file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-policy-'))
  const scope = new NativeScope()
  let fs: FileSystemOperations | undefined
  const consumer = {
    apiVersion: 1, name: 'test-consumer', targets: ['host'] as const, requires: ['fs'] as const, provides: [] as const,
    resolve: () => (context: import('@deepseek-ai/dsh-native-runtime').NativeContext) => { fs = context.require('fs') },
  }
  const policyRequest = { plugin, scope, config: undefined }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: directory } },
    policyRequest,
  ], 'host'))
  try {
    await host.start()
    if (fs === undefined) throw new Error('missing filesystem')
    const service = fs
    const target = await service.resolve('file.txt')
    const first = { agent: { session: {} } }
    const second = { agent: { session: {} } }
    await writeFile(join(directory, 'file.txt'), 'old')
    const initial = await service.stat(target)
    if (initial === undefined) throw new Error('missing file')
    host.events.emit(scope, 'fs/observed', target, { kind: 'present', version: initial.version }, first)
    await expect(host.events.waterfall(scope, 'fs/edit-intent', () => undefined, target, second)).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    await writeFile(join(directory, 'file.txt'), 'changed')
    const intent = await host.events.waterfall(scope, 'fs/edit-intent', () => undefined, target, first)
    await expect(service.editText(target, { oldString: 'old', newString: 'new', replaceAll: false }, intent)).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await readFile(join(directory, 'file.txt'), 'utf8')).toBe('changed')
    await host.remove(policyRequest)
    expect(await host.events.waterfall(scope, 'fs/edit-intent', () => undefined, target, first)).toBeUndefined()
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
