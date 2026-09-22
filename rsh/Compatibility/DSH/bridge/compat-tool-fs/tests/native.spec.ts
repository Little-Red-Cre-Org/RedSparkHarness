/** Legacy tool-fs contributes real tools and prompt text to one native Session. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { plugin as appPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import { plugin as sandboxFsPlugin } from '@deepseek-ai/dsh-compat-fs-sandbox/native'
import { plugin as sandboxPolicyPlugin } from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
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
  expect(() => resolveInstallation([{ plugin, scope, config: undefined }], 'host')).toThrow('missing fs')
})

it('passes per-session policy to a legacy write and preserves the denied file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-tool-sandbox-'))
  const file = join(directory, 'sample.txt')
  await writeFile(file, 'before')
  const scope = new NativeScope()
  let tools: NativeToolRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'sandbox-capture', targets: ['host'], requires: ['tools'], provides: [],
    resolve: () => (context) => { tools = context.require('tools') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: sandboxFsPlugin, scope, config: { cwd: directory } },
    { plugin: sandboxPolicyPlugin, scope, config: { mode: 'read-only', workspaceRoot: directory } },
    { plugin, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (tools === undefined) throw new Error('missing tools')
    const schema = tools.schemas().find(value => value.name === 'write')
    expect(schema?.parameters.properties).toHaveProperty('sandbox_permissions')
    const id = SessionId('sandbox-tool-session')
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: directory, isSeeded: false, delegationDepth: 0,
    })
    const read = await tools.execute({
      callId: ToolCallId('read-1'), name: 'read', arguments: { file_path: 'sample.txt' }, session,
      signal: new AbortController().signal,
    })
    expect(read.isError).toBe(false)
    const result = await tools.execute({
      callId: ToolCallId('write-1'), name: 'write', arguments: { file_path: 'sample.txt', content: 'after' }, session,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    const denial = result.content[0]
    expect(denial?.type).toBe('text')
    if (denial?.type === 'text') expect(denial.text).toContain('file access denied under read-only mode')
    expect(await readFile(file, 'utf8')).toBe('before')
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
    { plugin: modelPlugin, scope, config: undefined },
    { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: policyPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    bridge,
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
