/** The native installer schedules the same durable retries as the Cordis request-error policy. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ResolvedRetryPolicy, RetryPolicyConfig, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAdapterModel, plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import type { NativeModelExecution } from '@deepseek-ai/dsh-native-model-execution'
import * as retry from '../src/index.ts'
import { createNativeRetryPlugin, plugin } from '../src/native.ts'

type ScriptEntry = Error | readonly StreamChunk[]

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly entries: ScriptEntry[], private readonly policy: ResolvedRetryPolicy | undefined) { super() }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('retry test script exhausted')
    if (entry instanceof Error) throw entry
    yield* entry
  }
  override providerRetryPolicy(): ResolvedRetryPolicy | undefined { return this.policy }
}

const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const failure = (code: string, providerRetryAfterMs?: number): StreamChunk[] => [{
  type: 'finish',
  reason: { kind: 'error', failure: { message: `failed with ${code}`, code, ...providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs } } },
}]
const backoff = { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.2 }

/** Advance fake time until one operation settles without depending on its internal timer count. */
async function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  let result: PromiseSettledResult<T> | undefined
  operation.then((value) => { result = { status: 'fulfilled', value } }, (reason: unknown) => { result = { status: 'rejected', reason } })
  for (let index = 0; index < 200 && result === undefined; index++) await vi.advanceTimersByTimeAsync(250)
  if (result === undefined) throw new Error('operation did not settle')
  return result
}

/** One durable retry observation with the retry id replaced by its chain ordinal. */
interface Observation {
  readonly type: string
  readonly chain?: number | undefined
  readonly data?: Record<string, unknown>
}

/** Durable retry observations; retry ids are compared for chain identity rather than value. */
function observed(events: readonly SessionEvent[]): Observation[] {
  const ids = new Map<string, number>()
  return events.flatMap((event): Observation[] => {
    if (event.type === 'llm/retry') {
      const { retryId, ...data } = event.data
      if (!ids.has(retryId)) ids.set(retryId, ids.size)
      return [{ type: event.type, chain: ids.get(retryId), data }]
    }
    if (event.type === 'llm/retry-started') {
      const { retryId, ...data } = event.data
      return [{ type: event.type, chain: ids.get(retryId), data }]
    }
    if (event.type === 'assistant/attempt' || event.type === 'assistant/message') return [{ type: event.type }]
    return []
  })
}

async function runCordis(script: ScriptEntry[], policy: RetryPolicyConfig) {
  const adapter = new ScriptedAdapter(script, resolveRetryPolicy(policy, 'parity retryPolicy'))
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Object.assign((inner: Context) => { retry.apply(inner, {}, { random: () => 0.75 }) }, { inject: retry.inject }))
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('cordis-parity'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await settle(agent.whenIdle())
    return { events: observed(agent.session.snapshotEvents()), requests: adapter.requests.length }
  } finally {
    await ctx.fiber.dispose()
  }
}

async function nativeHost(adapter: LlmAdapter, retryPlugin: NativePlugin, beforeRetry?: NativePlugin) {
  const scope = new NativeScope()
  let execution: NativeModelExecution | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => {
      const selected = new NativeAdapterModel(adapter, context.signal)
      context.own(() => selected.close())
      context.provide('model', selected)
    },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'test-capture', targets: ['host'], requires: ['modelExecution'], provides: [],
    resolve: () => (context) => { execution = context.require('modelExecution') },
  }
  const retryRequest = { plugin: retryPlugin, scope, config: {} }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    ...(beforeRetry === undefined ? [] : [{ plugin: beforeRetry, scope, config: {} }]),
    retryRequest,
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: model, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (execution === undefined) throw new Error('missing model execution')
  return { host, execution, retryRequest }
}

function nativeSession() {
  const id = SessionId('native-parity')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/test', isSeeded: false, delegationDepth: 0,
  })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  return session
}

async function runNative(script: ScriptEntry[], policy: RetryPolicyConfig, signal = new AbortController().signal) {
  const adapter = new ScriptedAdapter(script, resolveRetryPolicy(policy, 'parity retryPolicy'))
  const { host, execution } = await nativeHost(adapter, createNativeRetryPlugin({ random: () => 0.75 }))
  try {
    const session = nativeSession()
    const events: SessionEvent[] = []
    let persisted = 0
    const prepared = await execution.prepareStep({ provider: 'mock', model: 'mock' })
    const options = { provider: 'mock', model: 'mock', messages: [], tools: [], sessionId: session.id, signal }
    const outcome = await settle(execution.execute({
      session, turn: 1, step: 1, prepared, options,
      rebuildOptions: () => ({ ...options, messages: session.deriveMessages() }),
      append: (event) => { events.push(event) }, persist: async () => { persisted = events.length },
    }))
    return { events: observed(events), requests: adapter.requests.length, outcome, persistedAll: persisted }
  } finally {
    await host.stop()
  }
}

afterEach(() => { vi.useRealTimers() })

describe('native llm-retry parity with the Cordis policy', () => {
  const scenarios: { name: string; script: () => ScriptEntry[]; policy: RetryPolicyConfig; retries: number; succeeds: boolean }[] = [
    { name: 'a thrown retryable adapter failure', policy: { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], backoff },
      script: () => [new LlmError('busy', 'RATE_LIMIT', { status: 429 }), text('done')], retries: 1, succeeds: true },
    { name: 'exhausted default retryable error finishes', policy: { mode: 'normal', maxRetries: 2, backoff },
      script: () => [failure(EMPTY_RESPONSE_CODE), failure(EMPTY_RESPONSE_CODE), failure(EMPTY_RESPONSE_CODE)],
      retries: 2, succeeds: false },
    { name: 'an unbounded policy', policy: { mode: 'always', backoff },
      script: () => [failure('SERVER'), failure('AUTH'), text('done')], retries: 2, succeeds: true },
    { name: 'a provider delay within the maximum', policy: { mode: 'normal', maxRetries: 2, backoff },
      script: () => [failure('RATE_LIMIT', 1_200), text('done')], retries: 1, succeeds: true },
    { name: 'a provider delay above the normal maximum', policy: { mode: 'normal', maxRetries: 2, backoff },
      script: () => [failure('RATE_LIMIT', 20_000), text('never')], retries: 0, succeeds: false },
    { name: 'a non-retryable code', policy: { mode: 'normal', maxRetries: 2, backoff },
      script: () => [failure('AUTH'), text('never')], retries: 0, succeeds: false },
  ]

  it.each(scenarios)('records identical retry events for $name', async ({ script, policy, retries, succeeds }) => {
    vi.useFakeTimers()
    const cordis = await runCordis(script(), policy)
    const native = await runNative(script(), policy)
    expect(native.events).toEqual(cordis.events)
    expect(native.requests).toBe(cordis.requests)
    expect(native.events.filter(event => event.type === 'llm/retry')).toHaveLength(retries)
    expect(native.events.filter(event => event.type === 'llm/retry-started')).toHaveLength(retries)
    expect(native.outcome.status).toBe(succeeds ? 'fulfilled' : 'rejected')
    // Every scheduled retry and its start transition are persisted before the next attempt.
    if (retries > 0) expect(native.persistedAll).toBeGreaterThan(0)
  })

  it('keeps the jittered local delay identical to the Cordis schedule', async () => {
    vi.useFakeTimers()
    const policy: RetryPolicyConfig = { mode: 'normal', maxRetries: 3, backoff }
    const script = (): ScriptEntry[] => [failure('SERVER'), failure('SERVER'), failure('SERVER'), text('done')]
    const native = await runNative(script(), policy)
    const cordis = await runCordis(script(), policy)
    expect(native.events.flatMap(event => event.type === 'llm/retry' ? [event.data?.delayMs] : []))
      .toEqual(cordis.events.flatMap(event => event.type === 'llm/retry' ? [event.data?.delayMs] : []))
    expect(native.events.flatMap(event => event.type === 'llm/retry' ? [event.data?.delayMs] : [])).toEqual([550, 1_100, 2_200])
    expect(new Set(native.events.flatMap(event => event.type === 'llm/retry' ? [event.chain] : []))).toEqual(new Set([0]))
  })
})

describe('native llm-retry lifecycle', () => {
  it('accepts only empty configuration', () => {
    expect(plugin.resolve(undefined)).toBeTypeOf('function')
    expect(plugin.resolve({})).toBeTypeOf('function')
    expect(() => plugin.resolve([])).toThrow('llm-retry: configuration must be an object')
    expect(() => plugin.resolve({ retryPolicy: {} })).toThrow('retryPolicy belongs under each provider configuration')
    expect(() => plugin.resolve({ maxRetries: 2 })).toThrow('llm-retry: unknown key "maxRetries"')
  })

  it('ends a scheduled wait on caller cancellation without another request', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const adapter = new ScriptedAdapter([failure('SERVER'), text('never')], resolveRetryPolicy({ mode: 'normal', maxRetries: 2, backoff }, 'policy'))
    const { host, execution } = await nativeHost(adapter, plugin)
    try {
      const session = nativeSession()
      const events: SessionEvent[] = []
      const signal = controller.signal
      const options = { provider: 'mock', model: 'mock', messages: [], tools: [], sessionId: session.id, signal }
      const running = execution.execute({
        session, turn: 1, step: 1, prepared: await execution.prepareStep({ provider: 'mock', model: 'mock' }),
        options, rebuildOptions: () => ({ ...options, messages: session.deriveMessages() }),
        append: (event) => { events.push(event) }, persist: () => Promise.resolve(),
      })
      const outcome = expect(running).rejects.toThrow('stopped')
      await vi.advanceTimersByTimeAsync(0)
      expect(events.map(event => event.type)).toEqual(['assistant/attempt', 'llm/retry'])
      controller.abort(new Error('stopped'))
      await outcome
      expect(adapter.requests).toHaveLength(1)
      expect(events.map(event => event.type)).toEqual(['assistant/attempt', 'llm/retry'])
    } finally {
      await host.stop()
    }
  })

  it('abandons a scheduled wait when the installation is removed', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([failure('SERVER'), text('never')], resolveRetryPolicy({ mode: 'normal', maxRetries: 2, backoff }, 'policy'))
    const { host, execution } = await nativeHost(adapter, plugin)
    const session = nativeSession()
    const signal = new AbortController().signal
    const options = { provider: 'mock', model: 'mock', messages: [], tools: [], sessionId: session.id, signal }
    const running = execution.execute({
      session, turn: 1, step: 1, prepared: await execution.prepareStep({ provider: 'mock', model: 'mock' }),
      options, rebuildOptions: () => ({ ...options, messages: session.deriveMessages() }),
      append: () => undefined, persist: () => Promise.resolve(),
    })
    const outcome = expect(running).rejects.toThrow('native-model-execution: model error: failed with SERVER')
    await vi.advanceTimersByTimeAsync(0)
    await host.stop()
    await outcome
    expect(adapter.requests).toHaveLength(1)
  })

  it('lets always retry recover after a delegated recovery failure', async () => {
    vi.useFakeTimers()
    const downstreamError = new Error('downstream recovery failed')
    const downstream: NativePlugin = {
      apiVersion: 1, name: 'test-downstream-recovery', targets: ['host'], requires: ['modelExecution'], provides: [],
      resolve: () => (context) => {
        context.effect(context.require('modelExecution').onRecovery(() => { throw downstreamError }))
      },
    }
    const policy = resolveRetryPolicy({
      mode: 'always', backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    }, 'policy')
    const adapter = new ScriptedAdapter([failure('SERVER'), text('recovered')], policy)
    const { host, execution } = await nativeHost(adapter, createNativeRetryPlugin({ random: () => 0.5 }), downstream)
    const session = nativeSession()
    const events: SessionEvent[] = []
    const signal = new AbortController().signal
    const options = { provider: 'mock', model: 'mock', messages: [], tools: [], sessionId: session.id, signal }
    try {
      const outcome = await settle(execution.execute({
        session, turn: 1, step: 1, prepared: await execution.prepareStep({ provider: 'mock', model: 'mock' }),
        options, rebuildOptions: () => ({ ...options, messages: session.deriveMessages() }),
        append: (event) => { events.push(event) }, persist: () => Promise.resolve(),
      }))
      expect(outcome.status).toBe('fulfilled')
      expect(adapter.requests).toHaveLength(2)
      expect(events.map(event => event.type)).toEqual([
        'assistant/attempt', 'llm/retry', 'llm/retry-started', 'assistant/message',
      ])
    } finally {
      await host.stop()
    }
  })

  it('keeps duplicate delegation fatal through an always retry policy', async () => {
    vi.useFakeTimers()
    const downstream: NativePlugin = {
      apiVersion: 1, name: 'test-duplicate-delegation', targets: ['host'], requires: ['modelExecution'], provides: [],
      resolve: () => (context) => {
        context.effect(context.require('modelExecution').onRecovery(async (_request, next) => {
          await next()
          return next()
        }))
      },
    }
    const policy = resolveRetryPolicy({
      mode: 'always', backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    }, 'policy')
    const adapter = new ScriptedAdapter([failure('SERVER'), text('never')], policy)
    const { host, execution } = await nativeHost(adapter, createNativeRetryPlugin({ random: () => 0.5 }), downstream)
    const session = nativeSession()
    const events: SessionEvent[] = []
    const signal = new AbortController().signal
    const options = { provider: 'mock', model: 'mock', messages: [], tools: [], sessionId: session.id, signal }
    try {
      const outcome = await settle(execution.execute({
        session, turn: 1, step: 1, prepared: await execution.prepareStep({ provider: 'mock', model: 'mock' }),
        options, rebuildOptions: () => ({ ...options, messages: session.deriveMessages() }),
        append: (event) => { events.push(event) }, persist: () => Promise.resolve(),
      }))
      expect(outcome.status).toBe('rejected')
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({ message: 'native-model-execution: recovery policy delegated more than once' })
      }
      expect(adapter.requests).toHaveLength(1)
      expect(events.map(event => event.type)).toEqual(['assistant/attempt', 'llm/retry', 'llm/retry-started'])
    } finally {
      await host.stop()
    }
  })

  it('does not retry when removal aborts during retry-started persistence', async () => {
    const policy = resolveRetryPolicy({
      mode: 'normal', maxRetries: 2,
      backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    }, 'policy')
    const adapter = new ScriptedAdapter([failure('SERVER'), text('never')], policy)
    const retryPlugin = createNativeRetryPlugin({ random: () => 0.5 })
    let retryLifetime: AbortSignal | undefined
    const observingRetryPlugin: NativePlugin = {
      ...retryPlugin,
      resolve(input) {
        const install = retryPlugin.resolve(input)
        return (context) => {
          retryLifetime = context.signal
          return install(context)
        }
      },
    }
    const { host, execution, retryRequest } = await nativeHost(adapter, observingRetryPlugin)
    const session = nativeSession()
    const events: SessionEvent[] = []
    const signal = new AbortController().signal
    const options = { provider: 'mock', model: 'mock', messages: [], tools: [], sessionId: session.id, signal }
    const startedPersist = Promise.withResolvers<undefined>()
    const releasePersist = Promise.withResolvers<undefined>()
    let persisted = 0
    try {
      const running = execution.execute({
        session, turn: 1, step: 1, prepared: await execution.prepareStep({ provider: 'mock', model: 'mock' }),
        options, rebuildOptions: () => ({ ...options, messages: session.deriveMessages() }),
        append: (event) => { events.push(event) },
        persist: async () => {
          persisted++
          if (events.at(-1)?.type === 'llm/retry-started') {
            startedPersist.resolve(undefined)
            await releasePersist.promise
          }
        },
      })
      const outcome = expect(running).rejects.toThrow('native-model-execution: model error: failed with SERVER')
      await startedPersist.promise
      const removal = host.remove(retryRequest)
      for (let turn = 0; turn < 50 && retryLifetime?.aborted !== true; turn++) {
        await new Promise(resolve => setImmediate(resolve))
      }
      expect(retryLifetime?.aborted).toBe(true)
      releasePersist.resolve(undefined)
      await outcome
      await removal
      expect(adapter.requests).toHaveLength(1)
      expect(events.map(event => event.type)).toEqual(['assistant/attempt', 'llm/retry', 'llm/retry-started'])
      expect(persisted).toBe(2)
    } finally {
      releasePersist.resolve(undefined)
      await host.stop()
    }
  })
})
