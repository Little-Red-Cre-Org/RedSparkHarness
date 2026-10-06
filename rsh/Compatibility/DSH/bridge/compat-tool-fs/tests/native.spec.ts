/** Legacy tool-fs contributes real tools and prompt text to one native Session. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as compatRuntimePlugin } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type { CompatDshRuntime } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-fs'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { plugin as appPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as nativeToolFsPlugin } from '@deepseek-ai/dsh-tool-fs/native'
import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import { plugin as sandboxFsPlugin } from '@deepseek-ai/dsh-compat-fs-sandbox/native'
import { plugin as sandboxPolicyPlugin } from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { plugin as compatPolicyPlugin } from '@deepseek-ai/dsh-compat-fs-policy/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin, validateLegacyToolManifest } from '../src/native.ts'

it('rejects unsupported declarations, config and missing native registries before activation', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../../Modules/Official/fs/tool-fs/package.json', import.meta.url), 'utf8')) as Parameters<typeof validateLegacyToolManifest>[0]
  expect(() => { validateLegacyToolManifest(manifest) }).not.toThrow()
  expect(() => { validateLegacyToolManifest({ dsh: { runtime: { apiVersion: 2, role: 'consumer', capability: 'filesystem' } } }) })
    .toThrow('unsupported')
  const scope = new NativeScope()
  expect(() => plugin.resolve({ invented: true })).toThrow('unsupported configuration field invented')
  expect(() => resolveInstallation([
    { plugin, scope, config: undefined }, { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host')).toThrow('missing fs')
})

it('passes per-session policy to a legacy write and preserves the denied file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-tool-sandbox-'))
  const file = join(directory, 'sample.txt')
  await writeFile(file, 'before')
  const scope = new NativeScope()
  let tools: NativeToolRegistry | undefined
  let agents: NativeAgentRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'sandbox-capture', targets: ['host'], requires: ['tools', 'agents'], provides: [],
    resolve: () => (context) => { tools = context.require('tools'); agents = context.require('agents') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: sandboxFsPlugin, scope, config: { cwd: directory } },
    { plugin: sandboxPolicyPlugin, scope, config: { mode: 'read-only', workspaceRoot: directory } },
    { plugin, scope, config: undefined },
    { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (tools === undefined || agents === undefined) throw new Error('missing native execution authorities')
    const schema = tools.schemas().find(value => value.name === 'write')
    expect(schema?.parameters.properties).toHaveProperty('sandbox_permissions')
    const id = SessionId('sandbox-tool-session')
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: directory, isSeeded: false, delegationDepth: 0,
    })
    const agent: NativeAgent = { id: NativeAgentId('sandbox-tool-agent'), scope }
    const unregister = agents.register(agent)
    const read = await tools.execute({
      agent,
      callId: ToolCallId('read-1'), name: 'read', arguments: { file_path: 'sample.txt' }, session,
      signal: new AbortController().signal,
      appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
    })
    expect(read.isError).toBe(false)
    const result = await tools.execute({
      agent,
      callId: ToolCallId('write-1'), name: 'write', arguments: { file_path: 'sample.txt', content: 'after' }, session,
      signal: new AbortController().signal,
      appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
    })
    expect(result.isError).toBe(true)
    const denial = result.content[0]
    expect(denial?.type).toBe('text')
    if (denial?.type === 'text') expect(denial.text).toContain('file access denied under read-only mode')
    expect(await readFile(file, 'utf8')).toBe('before')
    await unregister()
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('exposes the legacy read tool and prompt, records one result, then unloads contributions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-tool-fs-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  await mkdir(workspace)
  await writeFile(join(workspace, 'sample.txt'), 'first\nsecond\n')
  const scope = new NativeScope()
  const model = new MockAdapter([
    toolCallResponse('read-1', 'read', { file_path: 'sample.txt' }),
    textResponse('read complete'),
  ])
  const modelPlugin: NativePlugin = {
    apiVersion: 1, name: 'test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', model) },
  }
  let app: NativeApplication | undefined
  let tools: NativeToolRegistry | undefined
  let prompt: NativePromptRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'capture', targets: ['host'], requires: ['application', 'tools', 'promptSections'], provides: [],
    resolve: () => (context) => {
      app = context.require('application')
      tools = context.require('tools')
      prompt = context.require('promptSections')
    },
  }
  const bridge = { plugin, scope, config: { readLimit: 2 } }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Read the file.', maxSteps: 3 } },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: modelPlugin, scope, config: undefined },
    { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: policyPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    bridge,
    { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (app === undefined || tools === undefined || prompt === undefined) throw new Error('missing native consumer')
    const activeApp = app
    expect(tools.schemas().map(schema => schema.name).sort()).toEqual(['edit', 'read', 'write'])
    expect((await prompt.render())).toContain('Use the read tool')
    await host.run(scope, { kind: 'test' }, invocation => activeApp.run(['read', 'sample.txt'], invocation.signal))
    expect(model.requests).toHaveLength(2)
    const firstRequest = model.requests[0]
    if (firstRequest === undefined) throw new Error('missing first model request')
    if (firstRequest.tools === undefined) throw new Error('missing first model schemas')
    expect(firstRequest.tools.map(schema => schema.name)).toContain('read')
    const system = firstRequest.messages[0]?.content[0]
    expect(system?.type).toBe('text')
    if (system?.type === 'text') expect(system.text).toContain('Use the read tool')
    expect(model.requests[1]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call')).toHaveLength(1)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      } finally { await reader.close() }
    } finally { await storage.close() }
    await host.remove(bridge)
    expect(tools.schemas()).toEqual([])
    expect(await prompt.render()).toBe('')
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('delegates legacy write and edit waterfalls through native next callbacks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-tool-fs-waterfall-'))
  const scope = new NativeScope()
  let runtime: CompatDshRuntime | undefined
  let filesystem: FileSystemOperations | undefined
  let tools: NativeToolRegistry | undefined
  let agents: NativeAgentRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'compat-waterfall-capture', targets: ['host'],
    requires: ['compatDshRuntime', 'fs', 'tools', 'agents'], provides: [],
    resolve: () => (context) => {
      runtime = context.require('compatDshRuntime')
      filesystem = context.require('fs')
      tools = context.require('tools')
      agents = context.require('agents')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: compatRuntimePlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: directory } },
    { plugin: capture, scope, config: undefined },
    { plugin, scope, config: undefined },
  ], 'host'))
  let unregister: (() => Promise<void>) | undefined
  const disposers: (() => boolean)[] = []
  try {
    await host.start()
    if (runtime === undefined || filesystem === undefined || tools === undefined || agents === undefined) {
      throw new Error('missing compatibility waterfall services')
    }
    const legacy = runtime.context
    const sequence: string[] = []
    disposers.push(legacy.on('fs/write-intent', async (_target, _actor, next) => {
      sequence.push('write:outer')
      return next()
    }))
    disposers.push(legacy.on('fs/write-intent', async () => {
      sequence.push('write:terminal')
      return { kind: 'createIfAbsent' }
    }))
    disposers.push(legacy.on('fs/edit-intent', async (_target, _actor, next) => {
      sequence.push('edit:outer')
      return next()
    }))
    disposers.push(legacy.on('fs/edit-intent', async (target) => {
      sequence.push('edit:terminal')
      const info = await filesystem?.stat(target)
      if (info === undefined) throw new Error('missing file before edit waterfall')
      return { version: info.version }
    }))

    const id = SessionId('compat-waterfall-session')
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: directory, isSeeded: false, delegationDepth: 0,
    })
    const agent: NativeAgent = { id: NativeAgentId('compat-waterfall-agent'), scope }
    unregister = agents.register(agent)
    const signal = new AbortController().signal
    const execute = (callId: string, name: string, args: unknown) => tools?.execute({
      agent, callId: ToolCallId(callId), name, arguments: args, session, signal,
      appendEvent: async (type, data, ...options) => session.append(type, data, ...options),
    })
    const write = await execute('compat-waterfall-write', 'write', { file_path: 'sample.txt', content: 'before edit\n' })
    expect(write?.isError).toBe(false)
    const edit = await execute('compat-waterfall-edit', 'edit', {
      file_path: 'sample.txt', old_string: 'before', new_string: 'after',
    })
    expect(edit?.isError).toBe(false)
    const target = await filesystem.resolve('sample.txt')
    expect(await filesystem.readText(target)).toBe('after edit\n')
    expect(sequence).toEqual(['write:outer', 'write:terminal', 'edit:outer', 'edit:terminal'])
  } finally {
    for (const dispose of disposers) dispose()
    if (unregister !== undefined) await unregister()
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('uses the legacy observation policy for native file tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-tool-fs-native-'))
  await writeFile(join(directory, 'sample.txt'), 'before\n')
  const scope = new NativeScope()
  let tools: NativeToolRegistry | undefined
  let agents: NativeAgentRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'native-file-tool-capture', targets: ['host'], requires: ['tools', 'agents'], provides: [],
    resolve: () => (context) => { tools = context.require('tools'); agents = context.require('agents') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: directory } },
    { plugin: compatPolicyPlugin, scope, config: undefined },
    { plugin: nativeToolFsPlugin, scope, config: undefined },
    { plugin: compatRuntimePlugin, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (tools === undefined || agents === undefined) throw new Error('missing native tool registries')
    const id = SessionId('compat-native-tool-session')
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: directory, isSeeded: false, delegationDepth: 0,
    })
    const agent: NativeAgent = { id: NativeAgentId('compat-native-tool-agent'), scope }
    const unregister = agents.register(agent)
    const signal = new AbortController().signal
    try {
      const read = await tools.execute({
        agent, callId: ToolCallId('native-read-1'), name: 'read', arguments: { file_path: 'sample.txt' }, session, signal,
        appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
      })
      expect(read.isError).toBe(false)
      const write = await tools.execute({
        agent, callId: ToolCallId('native-write-1'), name: 'write', arguments: { file_path: 'sample.txt', content: 'after read\n' }, session, signal,
        appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
      })
      expect(write.isError).toBe(false)
      const edit = await tools.execute({
        agent, callId: ToolCallId('native-edit-1'), name: 'edit', arguments: { file_path: 'sample.txt', old_string: 'after', new_string: 'edited' }, session, signal,
        appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
      })
      expect(edit.isError).toBe(false)
      expect(await readFile(join(directory, 'sample.txt'), 'utf8')).toBe('edited read\n')
    } finally { await unregister() }
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
