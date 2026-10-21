/** Native Host composition with per-call confinement and installation-owned shutdown. */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { LocalFileSystemBackend } from '@deepseek-ai/dsh-fs-local/backend'
import { plugin as sandboxPolicyPlugin } from '../../../sandbox/native-sandbox-policy/src/native.ts'
import { plugin } from '../src/native.ts'
import { assertWorkspaceOutsideTemp } from '../../../../../Scripts/snapshot-workspace-parent.ts'

it('matches the native entry declaration while retaining the Cordis runtime face', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dsh: { native: unknown; runtime: unknown }
    exports: Record<string, unknown>
  }
  const metadata = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports)))
  expect(validateNativePluginEntry(plugin, metadata)).toBe(plugin)
  expect(manifest.dsh.runtime).toMatchObject({ apiVersion: 1, role: 'provider', capability: 'filesystem' })
})

it('confines native writes and edits per call, then cancels and drains owned filesystem work on stop', async () => {
  const base = await mkdtemp(join(homedir(), '.dsh-native-fssbx-'))
  const workspace = join(base, 'workspace')
  const outside = join(base, 'outside')
  assertWorkspaceOutsideTemp(base)
  await Promise.all([mkdir(workspace), mkdir(outside)])

  const scope = new NativeScope()
  let filesystem: FileSystemOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'native filesystem test consumer',
    targets: ['host'],
    requires: ['fs'],
    provides: [],
    resolve: () => (context) => { filesystem = context.require('fs') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: { cwd: workspace } },
    { plugin: sandboxPolicyPlugin, scope, config: { mode: 'workspace-write', workspaceRoot: workspace } },
  ], 'host'))

  try {
    await host.start()
    if (filesystem === undefined) throw new Error('missing native filesystem service')
    expect(filesystem.sandboxMode).toBe('workspace-write')

    const inside = await filesystem.resolve(join(workspace, 'inside.txt'))
    await filesystem.writeText(inside, 'before', { kind: 'createIfAbsent' })
    await filesystem.editText(inside, { oldString: 'before', newString: 'after', replaceAll: false })
    expect(await readFile(join(workspace, 'inside.txt'), 'utf8')).toBe('after')

    const outsidePath = join(outside, 'denied.txt')
    const outsideTarget = await filesystem.resolve(outsidePath)
    await expect(filesystem.writeText(outsideTarget, 'denied')).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    expect(existsSync(outsidePath)).toBe(false)
    await expect(filesystem.editText(outsideTarget, { oldString: 'before', newString: 'denied', replaceAll: false }))
      .rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    await expect(filesystem.writeText(inside, 'read only', undefined, undefined, {
      mode: 'read-only', workspaceRoot: workspace,
    })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    expect(await readFile(join(workspace, 'inside.txt'), 'utf8')).toBe('after')
    await expect(filesystem.writeText(outsideTarget, 'approved', undefined, undefined, {
      mode: 'danger-full-access', workspaceRoot: workspace,
    })).resolves.toMatchObject({ operation: 'create' })
    expect(await readFile(outsidePath, 'utf8')).toBe('approved')
    expect(await filesystem.readText(outsideTarget)).toBe('approved')

    const backend = filesystem as LocalFileSystemBackend
    expect(backend).toBeInstanceOf(LocalFileSystemBackend)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    backend.internals.inspectTemp = async () => { entered.resolve(undefined); await release.promise }
    const pendingPath = join(workspace, 'cancelled.txt')
    const pending = filesystem.writeText(await filesystem.resolve(pendingPath), 'cancelled', { kind: 'createIfAbsent' })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'FS_ABORTED' })
    await entered.promise
    let stopped = false
    const stopping = host.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    release.resolve(undefined)
    await stopping
    await rejected
    expect(existsSync(pendingPath)).toBe(false)
    await expect(filesystem.resolve('after-stop.txt')).rejects.toMatchObject({ code: 'FS_ABORTED' })
  } finally {
    await host.stop()
    await rm(base, { recursive: true, force: true })
  }
})

it('waits for an admitted sandbox check and rejects later mutations during shutdown', async () => {
  const base = await mkdtemp(join(homedir(), '.dsh-native-fssbx-drain-'))
  const workspace = join(base, 'workspace')
  assertWorkspaceOutsideTemp(base)
  await mkdir(workspace)

  const scope = new NativeScope()
  let filesystem: FileSystemOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'native filesystem drain test consumer',
    targets: ['host'],
    requires: ['fs'],
    provides: [],
    resolve: () => (context) => { filesystem = context.require('fs') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: { cwd: workspace } },
    { plugin: sandboxPolicyPlugin, scope, config: { mode: 'workspace-write', workspaceRoot: workspace } },
  ], 'host'))

  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const pendingPath = join(workspace, 'fenced-pending.txt')
  try {
    await host.start()
    if (filesystem === undefined) throw new Error('missing native filesystem service')
    const target = await filesystem.resolve(pendingPath)
    const backend = filesystem as LocalFileSystemBackend
    const resolveTarget = backend.resolve.bind(backend)
    // Hold the policy check after its backend resolution has settled.
    backend.resolve = async (path) => {
      const resolved = await resolveTarget(path)
      if (path === pendingPath) {
        entered.resolve(undefined)
        await release.promise
      }
      return resolved
    }

    const mutation = filesystem.writeText(target, 'pending', { kind: 'createIfAbsent' })
    const rejected = expect(mutation).rejects.toMatchObject({ code: 'FS_ABORTED' })
    await entered.promise
    let stopped = false
    const stopping = host.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    await expect(filesystem.writeText(target, 'after stop')).rejects.toMatchObject({ code: 'FS_ABORTED' })

    release.resolve(undefined)
    await stopping
    await rejected
    expect(existsSync(pendingPath)).toBe(false)
    await expect(filesystem.editText(target, { oldString: 'pending', newString: 'after stop', replaceAll: false }))
      .rejects.toMatchObject({ code: 'FS_ABORTED' })
  } finally {
    release.resolve(undefined)
    await host.stop()
    await rm(base, { recursive: true, force: true })
  }
})
