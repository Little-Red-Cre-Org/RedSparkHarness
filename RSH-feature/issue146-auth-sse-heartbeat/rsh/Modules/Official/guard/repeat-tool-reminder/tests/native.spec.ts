/**
 * The native settlement policy produces the same reminders as the Cordis guard for the same
 * sequence of recorded tool calls, and fails loud on the same invalid settings.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import * as RepeatToolGuard from '../src/index.ts'
import { plugin, resolveNativeRepeatToolReminderConfig } from '../src/native.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'

type Call = readonly [name: string, args: Record<string, unknown>]
type Turn = readonly Call[]

const flatten = (message: { content: readonly { type: string; text?: string }[]; source: unknown }) => ({
  text: message.content.map(block => block.type === 'text' ? block.text : '').join('|'),
  source: message.source,
})

async function cordisReminders(config: Record<string, unknown>, turns: readonly Turn[]) {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(RepeatToolGuard, config)
    for (const name of ['probe', 'other', 'pr.be']) {
      ctx.tools.register(defineContentToolFixture({ name, description: name, parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
    }
    let index = 0
    ctx.llm.registerAdapter(['mock'], new MockAdapter(turns.flatMap(turn => [
      ...turn.map(([name, args]) => toolCallResponse(`c${index++}`, name, args)),
      textResponse('done'),
    ])))
    const agent: Agent = await ctx.agentLoop.create(SessionId('parity'), { provider: 'mock', model: 'mock' })
    for (const [turn, _calls] of turns.entries()) {
      const idle = new Promise<void>((resolve) => {
        const off = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { off(); resolve() } })
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: `turn ${turn}` }], source: { kind: 'user' } }))
      await idle
    }
    return agent.session.snapshotEvents()
      .filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind !== 'user')
      .map(event => flatten(event.data))
  } finally {
    await ctx.fiber.dispose()
  }
}

async function nativeHost(config: unknown) {
  const scope = new NativeScope()
  let tools: NativeToolRegistry | undefined
  let agents: NativeAgentRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'capture', targets: ['host'], requires: ['tools', 'agents'], provides: [],
    resolve: () => (context) => { tools = context.require('tools'); agents = context.require('agents') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin, scope, config },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (tools === undefined || agents === undefined) throw new Error('missing native services')
  return { host, scope, tools, agents }
}

function nativeSession(id: string) {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false, cwd: '/' })
}

function settle(
  tools: NativeToolRegistry, agent: NativeAgent, session: Session, index: number, [name, args]: Call,
): readonly UserMessage[] {
  return tools.settlementContexts({
    agent, session, callId: ToolCallId(`c${index}`), name, arguments: args,
    result: { content: [{ type: 'text', text: 'ok' }], isError: false },
  })
}

async function nativeReminders(config: Record<string, unknown>, turns: readonly Turn[]) {
  const state = await nativeHost(config)
  try {
    const agent = { id: NativeAgentId('parity'), scope: state.scope }
    state.agents.register(agent)
    const session = nativeSession('parity')
    const found: ReturnType<typeof flatten>[] = []
    let index = 0
    for (const [turn, calls] of turns.entries()) {
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `turn ${turn}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      for (const call of calls) {
        const contexts = settle(state.tools, agent, session, index++, call)
        for (const context of contexts) session.append('user/message', context, { surfaceOp: 'append' })
        found.push(...contexts.map(flatten))
      }
    }
    return found
  } finally {
    await state.host.stop()
  }
}

const repeat = (count: number, call: Call): Call[] => Array.from({ length: count }, () => call)
const long = { q: 'x'.repeat(80) }

const scenarios: { name: string; config: Record<string, unknown>; turns: Turn[]; count: number }[] = [
  { name: 'gentle then detailed escalation', config: {}, turns: [repeat(5, ['probe', { q: 'same' }])], count: 2 },
  { name: 'unsorted thresholds', config: { thresholds: [4, 2] }, turns: [repeat(4, ['probe', {}])], count: 2 },
  { name: 'argument preview cap', config: { argumentsPreviewChars: 12 }, turns: [repeat(5, ['probe', long])], count: 2 },
  { name: 'different tracked call resets', config: {}, turns: [[...repeat(2, ['probe', { q: 1 }]), ['other', {}], ...repeat(3, ['probe', { q: 1 }])]], count: 1 },
  { name: 'excluded calls are transparent', config: { exclude: ['other'] }, turns: [[['probe', { q: 1 }], ['other', {}], ['probe', { q: 1 }], ['other', {}], ['probe', { q: 1 }]]], count: 1 },
  { name: 'include wildcard', config: { include: ['pro*'] }, turns: [[...repeat(3, ['other', {}]), ...repeat(3, ['probe', {}])]], count: 1 },
  { name: 'literal pattern dot', config: { exclude: ['pr.be'] }, turns: [repeat(3, ['probe', {}])], count: 1 },
  { name: 'deep canonical arguments', config: {}, turns: [[['probe', { a: 1, nested: { x: [1, 2], y: null } }], ['probe', { nested: { y: null, x: [1, 2] }, a: 1 }], ['probe', { a: 1, nested: { x: [1, 2], y: null } }]]], count: 1 },
  { name: 'new user input resets', config: {}, turns: [repeat(2, ['probe', { q: 1 }]), repeat(1, ['probe', { q: 1 }])], count: 0 },
  { name: 'repetition continues within one input', config: { thresholds: [2, 3] }, turns: [repeat(3, ['probe', { q: 1 }]), repeat(2, ['probe', { q: 1 }])], count: 3 },
]

describe('native repeat-tool reminder parity', () => {
  it.each(scenarios)('$name', async ({ config, turns, count }) => {
    const cordis = await cordisReminders(config, turns)
    const native = await nativeReminders(config, turns)
    expect(native).toEqual(cordis)
    expect(native).toHaveLength(count)
  })
})

describe('native repeat-tool reminder behavior', () => {
  it('counts failed settlements and keys chains per Agent', async () => {
    const state = await nativeHost({ thresholds: [2] })
    try {
      const first = { id: NativeAgentId('first'), scope: state.scope }
      const second = { id: NativeAgentId('second'), scope: state.scope }
      state.agents.register(first)
      state.agents.register(second)
      const sessions = [nativeSession('first'), nativeSession('second')] as const
      const denied = { content: [{ type: 'text' as const, text: 'Error: denied' }], isError: true, error: { name: 'Denied', code: 'DENIED' } }
      const call = (agent: NativeAgent, session: Session, index: number) => state.tools.settlementContexts({
        agent, session, callId: ToolCallId(`d${index}`), name: 'probe', arguments: { q: 1 }, result: denied,
      })
      expect(call(first, sessions[0], 0)).toEqual([])
      expect(call(second, sessions[1], 1)).toEqual([])
      expect(call(first, sessions[0], 2)).toHaveLength(1)
      expect(call(second, sessions[1], 3)).toHaveLength(1)
    } finally {
      await state.host.stop()
    }
  })

  it('stops reminding when the installation stops', async () => {
    const state = await nativeHost({ thresholds: [2] })
    const agent = { id: NativeAgentId('stopped'), scope: state.scope }
    state.agents.register(agent)
    const session = nativeSession('stopped')
    expect(settle(state.tools, agent, session, 0, ['probe', {}])).toEqual([])
    expect(settle(state.tools, agent, session, 1, ['probe', {}])).toHaveLength(1)
    await state.host.stop()
    expect(() => settle(state.tools, agent, session, 2, ['probe', {}])).toThrow()
  })
})

describe('native repeat-tool reminder configuration', () => {
  it('applies the Cordis defaults', () => {
    expect(resolveNativeRepeatToolReminderConfig(undefined))
      .toEqual({ thresholds: [3, 5, 8], include: [], exclude: [], argumentsPreviewChars: 500 })
  })

  it.each([
    [null, 'native configuration must be an object'],
    [{ unknown: true }, 'unknown configuration field unknown'],
  ])('rejects malformed configuration %j', (input, message) => {
    expect(() => plugin.resolve(input)).toThrow(`repeat-tool-reminder: ${message}`)
  })

  it.each<Record<string, unknown>>([{ thresholds: 'three' }, { include: [1] }, { argumentsPreviewChars: '500' }, { thresholds: [] }, { thresholds: [1] }, { thresholds: [2.5] }, { thresholds: [3, 3] }, { argumentsPreviewChars: 0 }, { argumentsPreviewChars: 1.5 }])(
    'rejects the same invalid settings as Cordis: %j', async (input) => {
      expect(() => plugin.resolve(input)).toThrow()
      const ctx = new Context()
      try {
        await mountAgentLoopTestDependencies(ctx)
        // Malformed values reach the shared schema exactly as an untyped profile would supply them.
        await expect(ctx.plugin(RepeatToolGuard, input as RepeatToolGuard.Config)).rejects.toThrow()
      } finally {
        await ctx.fiber.dispose()
      }
    })
})
