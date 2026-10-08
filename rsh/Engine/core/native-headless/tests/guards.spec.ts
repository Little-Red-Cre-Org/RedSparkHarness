/** The native headless loop applies the installed retry, tool-timeout and repeat-call guards. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as codeToolPlugin } from '@deepseek-ai/dsh-tool-code-runtime/native'
import { plugin as codeRuntimePlugin } from '@deepseek-ai/dsh-native-code-runtime/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { createNativeRetryPlugin } from '@deepseek-ai/dsh-llm-retry/native'
import { plugin as timeoutPlugin } from '@deepseek-ai/dsh-tool-call-timeout-policy/native'
import { plugin as repeatPlugin } from '@deepseek-ai/dsh-repeat-tool-reminder/native'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../agent-loop/tests/mock-adapter.ts'
import { plugin as appPlugin } from '../src/native.ts'

const retryPlugin = createNativeRetryPlugin({ random: () => 0.5 })

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], options: { ptc?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-guards-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  await mkdir(workspace, { recursive: true })
  const scope = new NativeScope()
  const adapter = new MockAdapter(script)
  let app: NativeApplication | undefined
  let tools: NativeToolRegistry | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', adapter) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'test-capture', targets: ['host'], requires: ['application', 'tools'], provides: [],
    resolve: () => (context) => { app = context.require('application'); tools = context.require('tools') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use tools.', maxSteps: 8, ...(options.ptc ? { builtinTools: false } : {}) } },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: codeRuntimePlugin, scope, config: { computeMs: 2_000, maxWallMs: 2_000 } },
    ...(options.ptc ? [{ plugin: codeToolPlugin, scope, config: undefined }] : []),
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: retryPlugin, scope, config: {} },
    { plugin: timeoutPlugin, scope, config: {} },
    { plugin: repeatPlugin, scope, config: { thresholds: [2, 3] } },
    { plugin: policyPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
    { plugin: model, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (app === undefined || tools === undefined) throw new Error('missing native application dependencies')
  const events = async (): Promise<SessionEvent[]> => {
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('Session was not stored')
      const reader = await storage.open(id, 'read')
      try { return [...(await reader.read()).events] } finally { await reader.close() }
    } finally { await storage.close() }
  }
  const cleanup = async () => {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
  return { host, scope, app, tools, adapter, events, cleanup }
}

function probe(tools: NativeToolRegistry, timeoutMs?: number) {
  return tools.register({
    schema: { name: 'probe', description: 'Probe.', parameters: { type: 'object', properties: { q: { type: 'number' } } } },
    ...timeoutMs === undefined ? {} : { timeoutMs },
    execute(call) {
      if (timeoutMs === undefined) return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], isError: false })
      return new Promise((resolve) => {
        call.signal.addEventListener('abort', () => { resolve({ content: [{ type: 'text', text: 'stopped' }], isError: false }) }, { once: true })
      })
    },
  })
}

const reminderSources = (events: readonly SessionEvent[]) => events.flatMap(event =>
  event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === 'repeat-tool-reminder' ? [event.data.source] : [])

it('retries a retryable model failure and completes the turn', async () => {
  const failure: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'server failed', code: 'SERVER' } } }]
  const state = await fixture([failure, textResponse('recovered')])
  try {
    await state.host.run(state.scope, { kind: 'retry' }, invocation => state.app.run(['retry'], invocation.signal))
    const events = await state.events()
    expect(events.filter(event => event.type === 'llm/retry')).toMatchObject([{ data: { retry: 1, failure: { code: 'SERVER' } } }])
    expect(events.filter(event => event.type === 'llm/retry-started')).toHaveLength(1)
    expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(state.adapter.requests).toHaveLength(2)
  } finally {
    await state.cleanup()
  }
})

it('records TOOL_TIMEOUT for a tool that exceeds its declared budget', async () => {
  const state = await fixture([toolCallResponse('slow-1', 'probe', { q: 1 }), textResponse('done')])
  const dispose = probe(state.tools, 50)
  try {
    await state.host.run(state.scope, { kind: 'timeout' }, invocation => state.app.run(['timeout'], invocation.signal))
    const result = (await state.events()).find(event => event.type === 'tool/result')
    expect(result).toMatchObject({ data: {
      error: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' },
      message: { content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'Error: tool call timed out after 50ms' }] }] },
    } })
  } finally {
    await dispose()
    await state.cleanup()
  }
})

it('appends repeat reminders after the repeated tool results', async () => {
  const state = await fixture([
    toolCallResponse('p1', 'probe', { q: 1 }),
    toolCallResponse('p2', 'probe', { q: 1 }),
    toolCallResponse('p3', 'probe', { q: 1 }),
    textResponse('done'),
  ])
  const dispose = probe(state.tools)
  try {
    await state.host.run(state.scope, { kind: 'repeat' }, invocation => state.app.run(['repeat'], invocation.signal))
    const events = await state.events()
    expect(reminderSources(events)).toEqual([
      { kind: 'plugin', plugin: 'repeat-tool-reminder', form: 'notice', summary: 'probe × 2' },
      { kind: 'plugin', plugin: 'repeat-tool-reminder', form: 'notice', summary: 'probe × 3' },
    ])
    const second = events.findIndex(event => event.type === 'tool/result' && event.data.message.content[0]?.type === 'tool-result' && event.data.message.content[0].toolCallId === 'p2')
    expect(events[second + 1]).toMatchObject({ type: 'user/message', data: { source: { summary: 'probe × 2' } } })
    // The model sees each reminder in its next request.
    expect(JSON.stringify(state.adapter.requests[2]?.messages)).toContain('repeating the exact same tool call')
  } finally {
    await dispose()
    await state.cleanup()
  }
})

it('counts nested programmatic tool calls toward the repeat chain', async () => {
  const state = await fixture([
    toolCallResponse('code-1', 'run_code', { code: 'await tools.probe({ q: 1 }); await tools.probe({ q: 1 }); return "done"', description: 'Probe twice.' }),
    textResponse('done'),
  ], { ptc: true })
  // Programs consume canonical values, so the nested tool declares an output schema.
  const dispose = state.tools.registerValueTool({
    schema: { name: 'probe', description: 'Probe.', parameters: { type: 'object', properties: { q: { type: 'number' } } } },
    output: { schema: { type: 'string' }, render: (_call, value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }) },
    execute: () => Promise.resolve('ok'),
  })
  try {
    await state.host.run(state.scope, { kind: 'repeat-ptc' }, invocation => state.app.run(['repeat'], invocation.signal))
    expect(reminderSources(await state.events())).toEqual([
      { kind: 'plugin', plugin: 'repeat-tool-reminder', form: 'notice', summary: 'probe × 2' },
    ])
  } finally {
    await dispose()
    await state.cleanup()
  }
})
