/** Legacy sandbox filesystem serves native consumers without a bare-local fallback. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as compatRuntimePlugin } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { plugin as localPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin, validateLegacySandboxManifest } from '../src/native.ts'

it('rejects changed declarations, config, missing policy and duplicate filesystem authority', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../../Modules/Official/fs/fs-sandbox/package.json', import.meta.url), 'utf8')) as Parameters<typeof validateLegacySandboxManifest>[0]
  expect(() => { validateLegacySandboxManifest(manifest) }).not.toThrow()
  expect(() => { validateLegacySandboxManifest({ dsh: { runtime: { apiVersion: 2, role: 'provider', capability: 'filesystem' } } }) }).toThrow('unsupported')
  const scope = new NativeScope()
  expect(() => plugin.resolve({ unknown: true })).toThrow('fs-local:')
  expect(() => resolveInstallation([
    { plugin, scope, config: {} }, { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host')).toThrow('missing sandboxPolicy')
  expect(() => resolveInstallation([
    { plugin, scope, config: {} }, { plugin: localPlugin, scope, config: {} },
    { plugin: policyPlugin, scope, config: { mode: 'read-only', workspaceRoot: tmpdir() } },
    { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host')).toThrow('duplicate')
})

it('denies read-only writes without changing files and allows workspace writes inside the root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-fs-sandbox-'))
  const file = join(directory, 'sample.txt')
  await writeFile(file, 'before')
  const scope = new NativeScope()
  let fs: FileSystemOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'sandbox-consumer', targets: ['host'], requires: ['fs'], provides: [],
    resolve: () => (context) => { fs = context.require('fs') },
  }
  const start = async (mode: 'read-only' | 'workspace-write') => {
    const host = new NativeHost(resolveInstallation([
      { plugin: consumer, scope, config: undefined },
      { plugin, scope, config: { cwd: directory } },
      { plugin: policyPlugin, scope, config: { mode, workspaceRoot: directory } },
      { plugin: compatRuntimePlugin, scope, config: undefined },
    ], 'host'))
    await host.start()
    return host
  }
  try {
    const denied = await start('read-only')
    try {
      if (fs === undefined) throw new Error('missing filesystem')
      const target = await fs.resolve(file)
      await expect(fs.writeText(target, 'after', undefined, undefined, { mode: 'read-only', workspaceRoot: directory }))
        .rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
      expect(await readFile(file, 'utf8')).toBe('before')
    } finally { await denied.stop() }
    const allowed = await start('workspace-write')
    try {
      if (fs === undefined) throw new Error('missing filesystem')
      const target = await fs.resolve(file)
      await fs.writeText(target, 'after', undefined, undefined, { mode: 'workspace-write', workspaceRoot: directory })
      expect(await readFile(file, 'utf8')).toBe('after')
    } finally { await allowed.stop() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
