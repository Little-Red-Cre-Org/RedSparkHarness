/** Native compaction through a real native Host: step-boundary pressure, `/compact`, and the optional pruner. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type InstallationRequest, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent'
import { plugin as executionPlugin, type NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import { plugin as commandsPlugin, type NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import { plugin as tokenMeterPlugin } from '@deepseek-ai/dsh-token-meter/native'
import { NativeHeadlessApplication, plugin as appPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { isCompactCheckpointSource, type NativeCompactionOperations } from '@deepseek-ai/dsh-compaction/native'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { PRUNE_MARKER, plugin as prunerPlugin } from '../../compaction-tool-result-pruner/src/native.ts'
import { plugin as compactCommandPlugin } from '../../command-compact/src/native.ts'
import { plugin as compactionPlugin, resolveNativeBasicCompactionConfig } from '../src/native.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

/** Mock adapter advertising a fixed context capacity for every route. */
class CapacityAdapter extends MockAdapter {
  constructor(script: Script, private readonly contextWindow: number | undefined) { super(script) }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const info = await super.resolveModel(provider, model)
    return this.contextWindow === undefined ? info : { ...info, context: { contextWindow: this.contextWindow } }
  }
}

interface FixtureOptions {
  readonly contextWindow?: number
  readonly compaction?: Record<string, unknown>
  readonly pruner?: Record<string, unknown> | false
}

const roots: string[] = []

async function fixture(script: Script, options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-compaction-'))
  roots.push(root)
  const scope = new NativeScope()
  const model = new CapacityAdapter(script, options.contextWindow)
  let app: NativeHeadlessApplication | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let commands: NativeCommandOperations | undefined
  let compaction: NativeCompactionOperations | undefined
  let activeSessions: NativeActiveSessionOperations | undefined
  const capture: NativePlugin = { apiVersion: 1, name: 'compaction-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'commands', 'compaction', 'activeSessions'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      storage = context.require('sessionPersistence')
      commands = context.require('commands')
      compaction = context.require('compaction')
      activeSessions = context.require('activeSessions')
    } }
  const modelProvider: NativePlugin = { apiVersion: 1, name: 'compaction-model', targets: ['host'],
    requires: [], provides: ['model'], resolve: () => (context) => { context.provide('model', model) } }
  const installation: InstallationRequest[] = [
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 4 } },
    { plugin: executionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: commandsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: modelProvider, scope, config: undefined },
    { plugin: tokenMeterPlugin, scope, config: undefined },
    ...options.pruner === false ? [] : [{ plugin: prunerPlugin, scope, config: options.pruner }],
    { plugin: compactionPlugin, scope, config: options.compaction },
    { plugin: compactCommandPlugin, scope, config: undefined },
  ]
  const host = new NativeHost(resolveInstallation(installation, 'host'))
  await host.start()
  if (app === undefined || storage === undefined || commands === undefined || compaction === undefined || activeSessions === undefined) {
    throw new Error('missing compaction fixture services')
  }
  const services = { app, storage, commands, compaction, activeSessions }
  return {
    ...services, model, root,
    async turn(id: SessionId, resume: boolean, text: string) {
      return services.app.executeTurn({ id, resume, message: createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text }] }) }, new AbortController().signal)
    },
    async command(id: SessionId, line: string, signal = new AbortController().signal) {
      return services.app.executeSessionOperation({ id, resume: true }, async (owner, effective) =>
        await services.commands.dispatch({ agent: owner.agent, session: owner.session, line, attachments: [], signal: effective }), signal)
    },
    async events(id: SessionId): Promise<readonly SessionEvent[]> {
      const reader = await services.storage.open(id, 'read')
      try { return (await reader.read()).events } finally { await reader.close() }
    },
    async close() { await host.stop() },
  }
}

function summaryRequest(options: GenerateOptions): boolean {
  return options.purpose === 'compaction'
}

function lastText(options: GenerateOptions): string {
  const content = options.messages.at(-1)?.content
  return Array.isArray(content) ? content.map(block => block.type === 'text' ? block.text : '').join('') : ''
}

vi.setConfig({ testTimeout: 15_000 })
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('native compaction configuration', () => {
  it('resolves the shared defaults with the pre-step admission priority', () => {
    const resolved = resolveNativeBasicCompactionConfig(undefined)
    expect(resolved.admissionOrder).toBe(100)
    expect(resolved.compaction).toMatchObject({ thresholdRatio: 0.8, retainRatio: 0.16, maxTokens: 8192, auto: true })
    expect(resolveNativeBasicCompactionConfig({ admissionOrder: -5, auto: false }))
      .toMatchObject({ admissionOrder: -5, compaction: { auto: false } })
  })

  it('rejects malformed configuration at installation', () => {
    expect(() => resolveNativeBasicCompactionConfig([])).toThrow(/must be an object/)
    expect(() => resolveNativeBasicCompactionConfig({ admissionOrder: Number.NaN })).toThrow(/admissionOrder/)
    expect(() => resolveNativeBasicCompactionConfig({ admissionOrder: '1' })).toThrow(/admissionOrder/)
    expect(() => resolveNativeBasicCompactionConfig({ threshold: 0.5 })).toThrow(/unknown key/)
    expect(() => resolveNativeBasicCompactionConfig({ retainRatio: 0.2, retainTokens: 100 })).toThrow()
  })
})

describe('native step-boundary pressure compaction', () => {
  it('replaces older history with one checkpoint before the next step enters', async () => {
    const state = await fixture([
      textResponse('B'.repeat(2_000)),
      textResponse('## Primary Request and Intent\n- condensed'),
      textResponse('Second answer.'),
    ], { contextWindow: 3_000 })
    const id = SessionId('native-compaction-pressure')
    try {
      await state.turn(id, false, 'A'.repeat(8_000))
      await state.turn(id, true, 'Continue.')
      expect(state.model.requests.map(summaryRequest)).toEqual([false, true, false])
      const summary = state.model.requests[1]
      expect(summary?.provider).toBe('mock')
      expect(summary?.model).toBe('parent')
      expect(summary?.maxTokens).toBe(8192)
      expect(lastText(summary as GenerateOptions)).toContain('compaction engine')
      const events = await state.events(id)
      const types = events.map(event => event.type)
      const start = types.indexOf('compaction/start')
      expect(start).toBeGreaterThan(types.lastIndexOf('turn/start'))
      expect(types.slice(start, types.indexOf('compaction/end') + 1)).toEqual(['compaction/start', 'compaction/summary', 'user/message', 'compaction/end'])
      const opening = events[start] as SessionEvent<'compaction/start'>
      expect(opening.data.turn).toBe(2)
      const checkpoint = events[start + 2] as SessionEvent<'user/message'>
      expect(isCompactCheckpointSource(checkpoint.data.source)).toBe(true)
      expect(checkpoint.surfaceOp).toMatchObject({ op: 'replace' })
      expect(JSON.stringify(checkpoint.data.content)).toContain('<compacted-summary>')
      const next = state.model.requests[2]
      expect(JSON.stringify(next?.messages)).not.toContain('A'.repeat(100))
      expect(JSON.stringify(next?.messages)).toContain('condensed')
    } finally { await state.close() }
  })

  it('stays idle below the threshold and when the routed model has no capacity', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = await fixture([textResponse('B'.repeat(2_000)), textResponse('One.'), textResponse('Two.')])
    const id = SessionId('native-compaction-unknown-capacity')
    try {
      await state.turn(id, false, 'A'.repeat(8_000))
      await state.turn(id, true, 'Continue.')
      await state.turn(id, true, 'Again.')
      expect(state.model.requests.some(summaryRequest)).toBe(false)
      expect((await state.events(id)).some(event => event.type === 'compaction/start')).toBe(false)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('no context capacity for mock/parent')
    } finally { warn.mockRestore(); await state.close() }

    const roomy = await fixture([textResponse('Small.'), textResponse('Still small.')], { contextWindow: 1_000_000 })
    const roomyId = SessionId('native-compaction-roomy')
    try {
      await roomy.turn(roomyId, false, 'Hello.')
      await roomy.turn(roomyId, true, 'Continue.')
      expect(roomy.model.requests.some(summaryRequest)).toBe(false)
    } finally { await roomy.close() }
  })

  it('installs no admission hook when automatic compaction is disabled', async () => {
    const state = await fixture([textResponse('B'.repeat(2_000)), textResponse('Two.')], { contextWindow: 3_000, compaction: { auto: false } })
    const id = SessionId('native-compaction-manual-only')
    try {
      await state.turn(id, false, 'A'.repeat(8_000))
      await state.turn(id, true, 'Continue.')
      expect(state.model.requests.some(summaryRequest)).toBe(false)
    } finally { await state.close() }
  })

  it('lands the model-free tool-result prune before choosing a summary range', async () => {
    const state = await fixture([
      toolCallResponse('call-1', 'read_file', { path: 'big.txt' }),
      textResponse('Read it.'),
    ], { contextWindow: 3_000, pruner: { thresholdChars: 2_000, headChars: 500, tailChars: 500 } })
    const id = SessionId('native-compaction-prune')
    try {
      await writeFile(join(state.root, 'big.txt'), 'L'.repeat(12_000))
      await state.turn(id, false, 'Read big.txt.')
      expect(state.model.requests.some(summaryRequest)).toBe(false)
      const events = await state.events(id)
      const prune = events.findIndex(event => event.type === 'compaction/prune')
      expect(prune).toBeGreaterThan(events.findIndex(event => event.type === 'tool/result'))
      const replacement = events[prune + 1] as SessionEvent<'tool/result'>
      expect(replacement.type).toBe('tool/result')
      expect(replacement.surfaceOp).toMatchObject({ op: 'replace' })
      expect(JSON.stringify(replacement.data.message.content)).toContain(PRUNE_MARKER.trim())
      expect(events.some(event => event.type === 'compaction/start')).toBe(false)
      const followUp = JSON.stringify(state.model.requests[1]?.messages)
      expect(followUp).toContain(PRUNE_MARKER.trim())
      expect(followUp).not.toContain('L'.repeat(2_000))
    } finally { await state.close() }
  })
})

describe('native /compact', () => {
  it('compacts idle history, persists the bracket and reports the result', async () => {
    const state = await fixture([
      textResponse('First answer.'),
      textResponse('Second answer.'),
      textResponse('Condensed checkpoint.'),
    ], { contextWindow: 1_000_000 })
    const id = SessionId('native-compaction-command')
    try {
      await state.turn(id, false, `First question: ${'detail '.repeat(200)}`)
      await state.turn(id, true, 'Second question.')
      const execution = await state.command(id, '/compact')
      expect(execution?.result).toMatchObject({ kind: 'success' })
      expect(execution?.result.text).toMatch(/^Compacted \d+ history items \(~\d+ tokens\)\.$/)
      expect(state.model.requests.at(-1)?.purpose).toBe('compaction')
      const events = await state.events(id)
      const types = events.map(event => event.type)
      const start = types.indexOf('compaction/start')
      expect(types.slice(start, start + 4)).toEqual(['compaction/start', 'compaction/summary', 'user/message', 'compaction/end'])
      const opening = events[start] as SessionEvent<'compaction/start'>
      const run = events.find((event): event is SessionEvent<'command/run'> => event.type === 'command/run')
      expect(opening.data.turn).toBeNull()
      expect(opening.data.sourceCommandId).toBe(run?.data.commandId)
      expect(types.slice(types.lastIndexOf('turn/end') + 1)).not.toContain('turn/start')
      const checkpoint = events[start + 2] as SessionEvent<'user/message'>
      expect(checkpoint.data.source).toMatchObject({ kind: 'plugin', compactionId: opening.data.compactionId })
    } finally { await state.close() }
  })

  it('reports usage errors, empty history and summary failures without changing the conversation', async () => {
    const state = await fixture([textResponse('Only answer.'), textResponse('')], { contextWindow: 1_000_000 })
    const id = SessionId('native-compaction-command-failures')
    try {
      const empty = await state.app.executeSessionOperation({ id, resume: false }, async (owner, signal) =>
        await state.commands.dispatch({ agent: owner.agent, session: owner.session, line: '/compact', attachments: [], signal }),
      new AbortController().signal)
      expect(empty?.result).toEqual({ kind: 'success', text: 'No compactable history yet.' })
      await state.turn(id, true, 'Only question.')
      expect((await state.command(id, '/compact now'))?.result).toEqual({ kind: 'error', text: 'Usage: /compact (no arguments)' })
      const failed = await state.command(id, '/compact')
      expect(failed?.result.kind).toBe('error')
      expect(failed?.result.text).toContain('could not produce a useful summary')
      const events = await state.events(id)
      const end = events.find((event): event is SessionEvent<'compaction/end'> => event.type === 'compaction/end')
      expect(end?.data.error).toBeDefined()
      expect(events.some(event => event.type === 'compaction/summary')).toBe(false)
    } finally { await state.close() }
  })

  it('closes the bracket with the failure when the command signal aborts during summarization', async () => {
    const state = await fixture([textResponse('First answer.'), textResponse('Second answer.'), 'hang'], { contextWindow: 1_000_000 })
    const id = SessionId('native-compaction-command-cancel')
    try {
      await state.turn(id, false, `First question: ${'detail '.repeat(200)}`)
      await state.turn(id, true, 'Second question.')
      const controller = new AbortController()
      const original = state.model.stream.bind(state.model)
      const spy = vi.spyOn(state.model, 'stream').mockImplementation(async function* (options): AsyncGenerator<StreamChunk> {
        queueMicrotask(() => { controller.abort(new Error('stop')) })
        yield* original(options)
      })
      try {
        const outcome = await state.app.executeSessionOperation({ id, resume: true }, async owner =>
          await state.commands.dispatch({ agent: owner.agent, session: owner.session, line: '/compact', attachments: [], signal: controller.signal }),
        new AbortController().signal)
        expect(outcome?.result).toEqual({ kind: 'error', text: 'stop' })
      } finally { spy.mockRestore() }
      const events = await state.events(id)
      const end = events.find((event): event is SessionEvent<'compaction/end'> => event.type === 'compaction/end')
      expect(end?.data.error).toBeDefined()
      expect(events.some(event => event.type === 'compaction/summary')).toBe(false)
      expect(events.at(-1)).toMatchObject({ type: 'command/done', data: { kind: 'error', text: 'stop' } })
    } finally { await state.close() }
  })

  it('rejects manual compaction while a turn is open', async () => {
    const state = await fixture([textResponse('First answer.'), textResponse('Second answer.')], { contextWindow: 1_000_000 })
    const id = SessionId('native-compaction-command-busy')
    try {
      await state.turn(id, false, 'First question.')
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const original = state.model.stream.bind(state.model)
      const spy = vi.spyOn(state.model, 'stream').mockImplementation(async function* (options): AsyncGenerator<StreamChunk> {
        entered.resolve(undefined)
        await resume.promise
        yield* original(options)
      })
      try {
        const run = state.turn(id, true, 'Second question.')
        await entered.promise
        const owner = state.activeSessions.owners()[0]
        if (owner === undefined) throw new Error('missing active owner')
        const outcome = await state.commands.dispatch({ agent: owner.agent, session: owner.session, line: '/compact',
          attachments: [], signal: new AbortController().signal })
        expect(outcome?.result.kind).toBe('error')
        expect(outcome?.result.text).toContain('not idle')
        resume.resolve(undefined)
        await run
      } finally { resume.resolve(undefined); spy.mockRestore() }
    } finally { await state.close() }
  })
})
