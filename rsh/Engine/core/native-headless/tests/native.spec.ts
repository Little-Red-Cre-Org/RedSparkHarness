/** Native Agent, model, filesystem tool, and released Session storage in one host. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { LocalFileSystemBackend } from '@deepseek-ai/dsh-fs-local/backend'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../agent-loop/tests/mock-adapter.ts'
import { plugin as appPlugin } from '../src/native.ts'

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-headless-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  await import('node:fs/promises').then(fs => fs.mkdir(workspace))
  const scope = new NativeScope()
  const adapter = new MockAdapter(script)
  let app: NativeApplication | undefined
  let filesystem: LocalFileSystemBackend | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', adapter) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'test-capture', targets: ['host'], requires: ['application', 'fs'], provides: [],
    resolve: () => (context) => {
      app = context.require('application')
      const provided = context.require('fs')
      if (!(provided instanceof LocalFileSystemBackend)) throw new Error('missing local filesystem')
      filesystem = provided
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use tools.', maxSteps: 4 } },
    { plugin: policyPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
    { plugin: model, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (app === undefined || filesystem === undefined) throw new Error('missing native application or filesystem')
  return { host, scope, app, filesystem, adapter, directory, workspace, sessions }
}

it('logs the model-visible request and tool result, then resumes the same stored Session', async () => {
  const state = await fixture([
    toolCallResponse('write-1', 'write_file', { path: 'created.txt', content: 'native content' }),
    textResponse('created'),
    textResponse('resumed'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'test' }, invocation => state.app.run(['create', 'the', 'file'], invocation.signal))
    expect(await readFile(join(state.workspace, 'created.txt'), 'utf8')).toBe('native content')
    expect(state.adapter.requests).toHaveLength(2)
    expect(state.adapter.requests[0]?.messages.some(message => message.role === 'user')).toBe(true)
    expect(state.adapter.requests[1]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const snapshots = await storage.list()
      expect(snapshots).toHaveLength(1)
      const id = snapshots[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      await state.host.run(state.scope, { kind: 'resume' }, invocation => state.app.run(['--resume', id, 'continue'], invocation.signal))
      const reader = await storage.open(SessionId(id), 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.filter(event => event.type === 'request/header')).toHaveLength(2)
        expect(events.filter(event => event.type === 'request/header').at(-1)).toMatchObject({ data: { reason: 'resume' } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('waits for an admitted model stream and persists the cancelled turn before shutdown', async () => {
  const entered = Promise.withResolvers<boolean>()
  const aborted = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()
  const state = await fixture(['hang'])
  const model = state.adapter
  model.stream = async function* (options) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'partial' }
    await new Promise<void>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        aborted.resolve(true)
        void release.promise.then(() => { reject(new Error('stream stopped')) })
      }, { once: true })
      entered.resolve(true)
    })
  }
  try {
    const running = state.host.run(state.scope, { kind: 'cancel-test' }, invocation => state.app.run(['cancel', 'me'], invocation.signal))
    await entered.promise
    let stopped = false
    const stopping = state.host.stop().then(() => { stopped = true })
    await aborted.promise
    expect(stopped).toBe(false)
    release.resolve(true)
    await expect(running).rejects.toThrow()
    await stopping
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('cancelled Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
        expect(events.some(event => event.type === 'assistant/attempt')).toBe(true)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    release.resolve(true)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('repairs a persisted tool call when shutdown interrupts the file write', async () => {
  const state = await fixture([toolCallResponse('write-1', 'write_file', { path: 'interrupted.txt', content: 'uncommitted' })])
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  state.filesystem.internals.inspectTemp = async () => { entered.resolve(undefined); await release.promise }
  try {
    const running = state.host.run(state.scope, { kind: 'cancel-write' }, invocation => state.app.run(['create', 'a', 'file'], invocation.signal))
    await entered.promise
    const stopping = state.host.stop()
    release.resolve(undefined)
    await expect(running).rejects.toThrow()
    await stopping
    await expect(readFile(join(state.workspace, 'interrupted.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('interrupted Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call')).toHaveLength(1)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    release.resolve(undefined)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('supports empty writes, denies paths outside the workspace, and records both tool outcomes', async () => {
  const state = await fixture([
    toolCallResponse('empty', 'write_file', { path: 'empty.txt', content: '' }),
    toolCallResponse('outside', 'write_file', { path: '../outside.txt', content: 'denied' }),
    textResponse('done'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'tools' }, invocation => state.app.run(['check', 'tools'], invocation.signal))
    expect(await readFile(join(state.workspace, 'empty.txt'), 'utf8')).toBe('')
    await expect(readFile(join(state.directory, 'outside.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(state.adapter.requests[2]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      const reader = await storage.open(id, 'read')
      try {
        const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(2)
        expect(results[0]?.type === 'tool/result' && results[0].data.message.content[0]?.type === 'tool-result' && results[0].data.message.content[0].isError).toBe(false)
        expect(results[1]).toMatchObject({ type: 'tool/result', data: { error: { code: 'FS_SANDBOX_DENIED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('records a max-token model finish without claiming normal completion', async () => {
  const state = await fixture([maxTokensResponse('partial')])
  try {
    await state.host.run(state.scope, { kind: 'max-tokens' }, invocation => state.app.run(['continue'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      const reader = await storage.open(id, 'read')
      try {
        expect((await reader.read()).events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})
