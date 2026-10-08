/**
 * The native execution policy records the same TOOL_TIMEOUT outcome as the Cordis wrapper and leaves
 * undeclared tools, fast bodies and caller cancellation to their ordinary outcomes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { NativeToolRegistry, type NativeToolContribution, type NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import * as timeoutPolicy from '../src/index.ts'
import { nativeToolTimeoutPolicy, nativeToolTimeoutResult, plugin, TOOL_TIMEOUT } from '../src/native.ts'

type Behavior = 'resolve-on-abort' | 'reject-on-abort' | 'fast'

function nativeFixture() {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId('timeout-owner'), scope }
  agents.register(agent)
  const tools = new NativeToolRegistry(agents, scope)
  const id = SessionId('timeout-session')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: '/' })
  const call = (name: string, signal = new AbortController().signal): NativeToolExecution => ({
    agent, session, name, callId: ToolCallId(`call-${name}`), arguments: {}, signal,
    appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
  })
  return { tools, call }
}

function nativeTool(
  name: string, behavior: Behavior, timeoutMs: number | undefined, seen?: (signal: AbortSignal) => void,
): NativeToolContribution {
  return {
    schema: { name, description: name, parameters: { type: 'object', properties: {} } },
    ...timeoutMs === undefined ? {} : { timeoutMs },
    execute(call) {
      seen?.(call.signal)
      const done = { content: [{ type: 'text' as const, text: 'stopped cooperatively' }], isError: false }
      if (behavior === 'fast') return Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }], isError: false })
      return new Promise((resolve, reject) => {
        call.signal.addEventListener('abort', () => {
          if (behavior === 'resolve-on-abort') resolve(done)
          else reject(new HarnessError('web fetch aborted', 'WEB_ABORTED'))
        }, { once: true })
      })
    },
  }
}

async function cordisOutcome(behavior: Behavior) {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(timeoutPolicy)
    ctx.tools.register(defineContentToolFixture({ name: 'slow', description: 'slow', parameters: {}, timeoutMs: 100,
      execute(_args, exec) {
        if (behavior === 'fast') return Promise.resolve([{ type: 'text' as const, text: 'ok' }])
        return new Promise((resolve, reject) => {
          exec.signal.addEventListener('abort', () => {
            if (behavior === 'resolve-on-abort') resolve([{ type: 'text' as const, text: 'stopped cooperatively' }])
            else reject(new HarnessError('web fetch aborted', 'WEB_ABORTED'))
          }, { once: true })
        })
      } }))
    const pending = ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('c1'), name: 'slow', arguments: {} })
    await vi.advanceTimersByTimeAsync(150)
    const result = await pending
    // The Cordis loop records `error.info` on tool/result; native records the same pair directly.
    return { content: result.content, isError: result.isError, ...result.error === undefined ? {} : { error: result.error.info } }
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('native timeout policy', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it.each(['resolve-on-abort', 'reject-on-abort'] as const)('records the Cordis TOOL_TIMEOUT outcome when the body %s', async (behavior) => {
    const cordis = await cordisOutcome(behavior)
    const state = nativeFixture()
    state.tools.aroundExecution(nativeToolTimeoutPolicy)
    state.tools.register(nativeTool('slow', behavior, 100))
    const pending = state.tools.execute(state.call('slow'))
    await vi.advanceTimersByTimeAsync(150)
    const native = await pending
    expect(native).toEqual(cordis)
    expect(native).toEqual({
      content: [{ type: 'text', text: 'Error: tool call timed out after 100ms' }],
      isError: true,
      error: { name: 'ToolTimeoutError', code: TOOL_TIMEOUT },
    })
    expect(nativeToolTimeoutResult(100)).toEqual(native)
  })

  it('keeps a fast budgeted result and supplies a derived signal only to budgeted tools', async () => {
    const state = nativeFixture()
    const admitted: AbortSignal[] = []
    // Earlier registrations surround later ones, so this observer sees the admitted signal.
    state.tools.aroundExecution(async (call, _tool, next) => { admitted.push(call.signal); return next(call.signal) })
    state.tools.aroundExecution(nativeToolTimeoutPolicy)
    const caller = new AbortController()
    const signals: AbortSignal[] = []
    state.tools.register(nativeTool('fast', 'fast', 10_000, signal => signals.push(signal)))
    state.tools.register(nativeTool('plain', 'fast', undefined, signal => signals.push(signal)))
    expect(await state.tools.execute(state.call('fast', caller.signal))).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false })
    expect(await state.tools.execute(state.call('plain', caller.signal))).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false })
    // Only the budgeted body sees a derived deadline signal.
    expect(signals[0]).not.toBe(admitted[0])
    expect(signals[1]).toBe(admitted[1])
    expect(await state.tools.execute(state.call('fast', caller.signal))).toMatchObject({ isError: false })
    await vi.advanceTimersByTimeAsync(20_000)
  })

  it('leaves caller cancellation to its ordinary outcome instead of reporting a timeout', async () => {
    const state = nativeFixture()
    state.tools.aroundExecution(nativeToolTimeoutPolicy)
    state.tools.register(nativeTool('slow', 'reject-on-abort', 100))
    const caller = new AbortController()
    const pending = state.tools.execute(state.call('slow', caller.signal))
    const rejected = expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await vi.advanceTimersByTimeAsync(10)
    caller.abort('user cancelled')
    await rejected
  })
})

describe('native timeout installation', () => {
  it('accepts only empty configuration', () => {
    expect(plugin.resolve(undefined)).toBeTypeOf('function')
    expect(plugin.resolve({})).toBeTypeOf('function')
    for (const input of [null, [], { timeoutMs: 1 }]) {
      expect(() => plugin.resolve(input)).toThrow('timeout-policy: native configuration must be empty')
    }
  })

  it('installs over the selected registry and stops enforcing after removal', async () => {
    vi.useFakeTimers()
    try {
      const scope = new NativeScope()
      let tools: NativeToolRegistry | undefined
      let agents: NativeAgentRegistry | undefined
      const capture: NativePlugin = {
        apiVersion: 1, name: 'capture', targets: ['host'], requires: ['tools', 'agents'], provides: [],
        resolve: () => (context) => { tools = context.require('tools'); agents = context.require('agents') },
      }
      const host = new NativeHost(resolveInstallation([
        { plugin: capture, scope, config: undefined },
        { plugin, scope, config: {} },
        { plugin: toolsPlugin, scope, config: undefined },
        { plugin: agentPlugin, scope, config: undefined },
      ], 'host'))
      await host.start()
      try {
        if (tools === undefined || agents === undefined) throw new Error('missing services')
        const agent = { id: NativeAgentId('installed'), scope }
        agents.register(agent)
        tools.register(nativeTool('slow', 'resolve-on-abort', 50))
        const id = SessionId('installed-session')
        const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: '/' })
        const pending = tools.execute({ agent, session, name: 'slow', callId: ToolCallId('c'), arguments: {}, signal: new AbortController().signal,
          appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts) })
        await vi.advanceTimersByTimeAsync(60)
        expect(await pending).toEqual(nativeToolTimeoutResult(50))
      } finally {
        await host.stop()
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
