/** Real Native application requests keep model schemas, execution and restored Session grants aligned. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as agentsPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as appPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { plugin as modelPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as sessionPlugin } from '@deepseek-ai/dsh-native-session-execution'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as observationPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { plugin as codePlugin } from '@deepseek-ai/dsh-tool-code-runtime/native'
import { plugin as runtimePlugin } from '@deepseek-ai/dsh-native-code-runtime/native'
import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin } from '../src/native.ts'

function batch(): StreamChunk[] {
  const open = toolCallResponse('open', 'request_tool_group', { group: 'edit' }).filter(c => c.type !== 'finish' && c.type !== 'usage')
  const edit = toolCallResponse('early', 'edit', {}).map(c => 'index' in c ? { ...c, index: 1 } : c)
  return [...open, ...edit]
}

it.each(['native', 'both'] as const)('opens on the next request and restores only the same Session (%s)', async (mode) => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-tool-groups-'))
  const workspace = join(directory, 'work')
  const storageRoot = join(directory, 'sessions')
  await mkdir(workspace)
  let writes = 0
  let app!: NativeApplication
  let tools!: NativeToolRegistry
  const adapter = new MockAdapter([
    mode === 'native' ? batch() : toolCallResponse('open-program', 'run_code', {
      code: "await tools.request_tool_group({ group: 'edit' }); await tools.edit({});", description: 'Open edit tools',
    }),
    (options) => {
      expect(writes).toBe(0)
      expect(options.tools?.map(tool => tool.name)).toContain('edit')
      return mode === 'native' ? toolCallResponse('edit-now', 'edit', {})
        : toolCallResponse('edit-program', 'run_code', { code: 'return await tools.edit({});', description: 'Edit' })
    },
    textResponse('done'), textResponse('restored'), textResponse('new task'), textResponse('warm resume'),
    mode === 'native' ? toolCallResponse('guarded', 'edit', {}) : toolCallResponse('guarded-program', 'run_code', {
      code: 'return await tools.edit({});', description: 'Attempt guarded edit',
    }),
    textResponse('guarded'),
  ])
  const scope = new NativeScope()
  const fixture: NativePlugin = {
    apiVersion: 1, name: 'group-fixture', targets: ['host'], requires: ['tools'], provides: ['model'],
    resolve: () => (context) => {
      tools = context.require('tools')
      context.provide('model', adapter)
      for (const name of ['read', 'edit']) context.effect(tools.registerValueTool({
        schema: { name, description: name, parameters: { type: 'object', properties: {}, additionalProperties: false } },
        output: { schema: { type: 'string' }, render: (_call, value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }) },
        execute: async () => { if (name === 'edit') writes++; return name },
      }, context.scope))
    },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'capture', targets: ['host'], requires: ['application'], provides: [],
    resolve: () => (context) => { app = context.require('application') },
  }
  const installation = () => resolveInstallation([
    { plugin: agentsPlugin, scope, config: undefined },
    { plugin: sessionPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: { mode } },
    { plugin: fixture, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: observationPlugin, scope, config: undefined },
    { plugin: storagePlugin, scope, config: { root: storageRoot, compression: 'none' } },
    { plugin: modelPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    ...(mode === 'both' ? [
      { plugin: runtimePlugin, scope, config: { computeMs: 2_000, maxWallMs: 2_000 } },
      { plugin: codePlugin, scope, config: { sdkPrompt: true } },
    ] : []),
    { plugin: appPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use tools.', builtinTools: false, maxSteps: 4 } },
    { plugin, scope, config: { initial: ['read'], groups: [{ name: 'edit', description: 'Edit workspace files', tools: ['edit'] }] } },
    { plugin: capture, scope, config: undefined },
  ], 'host')
  let host = new NativeHost(installation())
  const storage = new JsonlSessionBackend({ root: storageRoot, compression: 'none' })
  try {
    await host.start()
    await host.run(scope, { kind: 'test' }, invocation => app.run(['edit'], invocation.signal))
    expect(writes).toBe(1)
    expect(adapter.requests[0]!.tools!.map(tool => tool.name)).not.toContain('edit')
    const entries = await storage.list({})
    const id = entries[0]!.header.id
    const reader = await storage.open(id, 'read')
    const events = (await reader.read()).events
    await reader.close()
    expect(events.filter(e => e.type === 'request/header').map(e => e.data.header.tools?.map(t => t.name)))
      .toEqual([adapter.requests[0]!.tools!.map(t => t.name), adapter.requests[1]!.tools!.map(t => t.name)])
    expect(events.filter(e => e.type === 'tool-groups/opened')).toHaveLength(1)
    expect(events.some(e => e.type === 'tool/result' && e.data.message.content.some(b => b.type === 'tool-result' && b.isError))).toBe(true)
    await host.stop()
    expect(tools.schemas()).toEqual([])
    host = new NativeHost(installation())
    await host.start()
    await host.run(scope, { kind: 'test' }, invocation => app.run(['--resume', id, 'resume'], invocation.signal))
    expect(adapter.requests[3]!.tools!.map(t => t.name)).toContain('edit')
    await host.run(scope, { kind: 'test' }, invocation => app.run(['new'], invocation.signal))
    expect(adapter.requests[4]!.tools!.map(t => t.name)).not.toContain('edit')
    await host.run(scope, { kind: 'test' }, invocation => app.run(['--resume', id, 'continue'], invocation.signal))
    expect(adapter.requests[5]!.tools!.map(t => t.name)).toContain('edit')
    let denied = false
    tools.guard((call) => {
      if (call.name !== 'edit') return
      denied = true
      return 'operation is forbidden'
    })
    await host.run(scope, { kind: 'test' }, invocation => app.run(['--resume', id, 'try guarded edit'], invocation.signal))
    expect(writes).toBe(1)
    expect(denied).toBe(true)
  } finally {
    await host.stop()
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  }
})
