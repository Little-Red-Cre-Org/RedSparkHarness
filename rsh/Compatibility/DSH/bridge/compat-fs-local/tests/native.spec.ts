/** Cordis filesystem Provider serving the production Native file-tool Consumer. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import type { CompatDshRuntime } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import { plugin as compatRuntimePlugin } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { plugin as nativePolicyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { LocalFileSystemBackend } from '@deepseek-ai/dsh-fs-local/backend'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { plugin as nativeFileToolsPlugin } from '@deepseek-ai/dsh-tool-fs/native'
import { plugin as compatFsLocalPlugin, validateLegacyFilesystemManifest } from '../src/native.ts'

it('checks the selected legacy declaration and configuration before activation', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../../Modules/Official/fs/fs-local/package.json', import.meta.url), 'utf8')) as Parameters<typeof validateLegacyFilesystemManifest>[0]
  expect(() => { validateLegacyFilesystemManifest(manifest) }).not.toThrow()
  expect(() => { validateLegacyFilesystemManifest({ ...manifest, version: '0.1.6' }) }).toThrow('unsupported @deepseek-ai/dsh-fs-local version')
  expect(() => { validateLegacyFilesystemManifest({ ...manifest, name: '@deepseek-ai/other' }) }).toThrow('package name')
  expect(() => { validateLegacyFilesystemManifest({ ...manifest, dsh: { ...manifest.dsh, runtime: { apiVersion: 2, role: 'provider', capability: 'filesystem' } } }) })
    .toThrow('unsupported')
  expect(() => compatFsLocalPlugin.resolve({ unknown: true })).toThrow('fs-local:')
})

it('serves an unchanged native Consumer and rejects a duplicate Provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-fs-local-'))
  const updatedDirectory = join(directory, 'updated')
  const substituteDirectory = join(directory, 'substitute')
  await mkdir(updatedDirectory)
  await mkdir(substituteDirectory)
  await writeFile(join(updatedDirectory, 'sample.txt'), 'from real provider\n'.repeat(5000))
  const scope = new NativeScope()
  let runtime: CompatDshRuntime | undefined
  let tools: NativeToolRegistry | undefined
  let agents: NativeAgentRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'native-file-tool-capture', targets: ['host'], requires: ['compatDshRuntime', 'tools', 'agents'], provides: [],
    resolve: () => (context) => {
      runtime = context.require('compatDshRuntime')
      tools = context.require('tools')
      agents = context.require('agents')
    },
  }
  const agentRequest = { plugin: agentPlugin, scope, config: undefined }
  const toolsRequest = { plugin: toolsPlugin, scope, config: undefined }
  const policyRequest = { plugin: nativePolicyPlugin, scope, config: undefined }
  const toolRequest = { plugin: nativeFileToolsPlugin, scope, config: { readStreamMinSize: 1, readLimit: 1 } }
  const captureRequest = { plugin: capture, scope, config: undefined }
  const legacy = { plugin: compatFsLocalPlugin, scope, config: { cwd: directory } }
  const compatRuntimeRequest = { plugin: compatRuntimePlugin, scope, config: undefined }
  const host = new NativeHost(resolveInstallation([
    compatRuntimeRequest, agentRequest, toolsRequest, policyRequest, toolRequest, captureRequest, legacy,
  ], 'host'))
  const order: string[] = []
  const servedBy: string[] = []
  let activeCall: string | undefined
  const writeEntered = Promise.withResolvers<undefined>()
  const releaseWrite = Promise.withResolvers<undefined>()
  const cleanupEntered = Promise.withResolvers<undefined>()
  let inFlight: Promise<unknown> | undefined
  let replacing: Promise<void> | undefined
  let unregister: (() => Promise<void>) | undefined
  try {
    expect(() => resolveInstallation([legacy, { plugin: localFilesystemPlugin, scope, config: { cwd: directory } }, compatRuntimeRequest], 'host'))
      .toThrow('duplicate')
    await host.start()
    if (runtime === undefined || tools === undefined || agents === undefined) throw new Error('missing Native file tool services')
    const compat = runtime
    const liveFilesystem = compat.liveService('fs') as FileSystemOperations
    const target = await liveFilesystem.resolve('legacy.txt')
    await liveFilesystem.writeText(target, 'from Cordis', { kind: 'createIfAbsent' })
    expect(await readFile(join(directory, 'legacy.txt'), 'utf8')).toBe('from Cordis')
    await compat.update('@deepseek-ai/dsh-fs-local', { cwd: updatedDirectory })
    const oldFilesystem = compat.context.get('fs')
    if (!(oldFilesystem instanceof LocalFileSystem)) throw new Error('missing current Cordis LocalFileSystem')
    expect(oldFilesystem.config.cwd).toBe(updatedDirectory)
    const updatedTarget = await liveFilesystem.resolve('updated.txt')
    await liveFilesystem.writeText(updatedTarget, 'after update', { kind: 'createIfAbsent' })
    expect(await readFile(join(updatedDirectory, 'updated.txt'), 'utf8')).toBe('after update')
    const oldTarget = await liveFilesystem.resolve('sample.txt')
    const oldBackend = (oldFilesystem as unknown as { backend: LocalFileSystemBackend }).backend
    const streamText = oldFilesystem.streamText.bind(oldFilesystem)
    oldFilesystem.streamText = async (target, signal) => {
      servedBy.push(`${activeCall}:legacy`)
      return streamText(target, signal)
    }
    const close = oldBackend.close.bind(oldBackend)
    oldBackend.close = async () => {
      const closing = close()
      order.push('old cleanup entered')
      cleanupEntered.resolve(undefined)
      await closing
      order.push('old cleanup completed')
    }
    const id = SessionId('compat-fs-local-native-tool')
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: updatedDirectory, isSeeded: false, delegationDepth: 0,
    })
    const agent: NativeAgent = { id: NativeAgentId('compat-fs-local-native-agent'), scope }
    unregister = agents.register(agent)
    const readRequest = { file_path: 'sample.txt', offset: 1, limit: 1 }
    const signal = new AbortController().signal
    const readThroughTool = (label: string, callId: string) => {
      activeCall = label
      return host.runOwned(toolRequest, {}, async () => {
        try {
          if (tools === undefined) throw new Error('missing Native file tool registry')
          const result = await tools.execute({
            agent, callId: ToolCallId(callId), name: 'read', arguments: readRequest, session, signal,
            appendEvent: async (type, data, ...options) => session.append(type, data, ...options),
          })
          if (result.isError) throw new Error(`Native read failed: ${result.error?.code ?? 'unknown error'}`)
          return result.value
        } finally { activeCall = undefined }
      })
    }
    const before = await readThroughTool('before', 'compat-fs-local-before')
    expect(before).toMatchObject({ lines: [{ number: 1, text: 'from real provider' }] })
    expect(servedBy).toEqual(['before:legacy'])

    oldBackend.internals.inspectTemp = async () => {
      writeEntered.resolve(undefined)
      await releaseWrite.promise
    }
    inFlight = host.runOwned(toolRequest, {}, async () => {
      if (tools === undefined) throw new Error('missing Native file tool registry')
      return tools.execute({
        agent, callId: ToolCallId('compat-fs-local-in-flight'), name: 'write',
        arguments: { file_path: 'cancelled.txt', content: 'cancelled by replacement' }, session, signal,
        appendEvent: async (type, data, ...options) => session.append(type, data, ...options),
      })
    })
    await writeEntered.promise
    let replacementSettled = false
    replacing = compat.update('@deepseek-ai/dsh-fs-local', { cwd: substituteDirectory }).then(() => { replacementSettled = true })
    try {
      await cleanupEntered.promise
      expect(replacementSettled).toBe(false)
      expect(compat.context.get('fs')).toBeUndefined()
      expect(order).toEqual(['old cleanup entered'])
      releaseWrite.resolve(undefined)
      await expect(inFlight).rejects.toMatchObject({ code: 'FS_ABORTED' })
      await replacing
      const substituteFilesystem = compat.context.get('fs')
      if (!(substituteFilesystem instanceof LocalFileSystem)) throw new Error('missing substitute Cordis LocalFileSystem')
      expect(substituteFilesystem.config.cwd).toBe(substituteDirectory)
      await expect(oldFilesystem.readText(oldTarget)).rejects.toMatchObject({ code: 'FS_ABORTED' })
      expect(order).toEqual(['old cleanup entered', 'old cleanup completed'])
      await writeFile(join(updatedDirectory, 'sample.txt'), 'from substitute provider\n'.repeat(5000))
      const substituteStreamText = substituteFilesystem.streamText.bind(substituteFilesystem)
      substituteFilesystem.streamText = async (target, signal) => {
        servedBy.push(`${activeCall}:substitute`)
        order.push('substitute served')
        return substituteStreamText(target, signal)
      }
      const after = await readThroughTool('after', 'compat-fs-local-after')
      expect(after).toMatchObject({ lines: [{ number: 1, text: 'from substitute provider' }] })
      expect(after).not.toEqual(before)
      expect(servedBy).toEqual(['before:legacy', 'after:substitute'])
      expect(order).toEqual(['old cleanup entered', 'old cleanup completed', 'substitute served'])
      await compat.remove('@deepseek-ai/dsh-fs-local')
      expect(() => liveFilesystem.resolve('after-remove.txt')).toThrow('Cordis service fs is unavailable')
    } finally {
      releaseWrite.resolve(undefined)
      await Promise.allSettled([inFlight, replacing])
    }
  } finally {
    releaseWrite.resolve(undefined)
    if (unregister !== undefined) await unregister()
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
    { plugin: consumer, scope, config: undefined }, { plugin: compatFsLocalPlugin, scope, config: { cwd: directory } },
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
