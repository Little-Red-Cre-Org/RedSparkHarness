/** Surrounding execution policies and settlement context policies over the scoped registry. */
import { describe, expect, it, vi } from 'vitest'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { NativeToolRegistry, type NativeToolDeclaration, type NativeToolExecution, type NativeToolResult,
  type NativeToolSettlement } from '../src/index.ts'
import { createNativePtcDispatch } from '../src/ptc-dispatch.ts'

function fixture() {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId('policy-owner'), scope }
  agents.register(agent)
  const tools = new NativeToolRegistry(agents, scope)
  const id = SessionId('policy-session')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: '/' })
  const events: SessionEvent[] = []
  const call = (name: string, args: unknown = {}, signal = new AbortController().signal): NativeToolExecution => ({
    agent, session, name, callId: ToolCallId(`call-${name}`), arguments: args, signal,
    appendEvent: async (type, data, ...opts) => {
      const event = session.append(type, data, ...opts)
      events.push(event as SessionEvent)
      return event
    },
  })
  return { scope, agents, agent, tools, session, events, call }
}

const ok = (text: string): NativeToolResult => ({ content: [{ type: 'text', text }], isError: false })
const schema = (name: string) => ({ name, description: name, parameters: { type: 'object' as const, properties: {} } })

describe('execution policies', () => {
  it('validates declared budgets and exposes them to policies', async () => {
    const state = fixture()
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(() => state.tools.register({ schema: schema('bad'), timeoutMs, execute: async () => ok('never') }))
        .toThrow('timeoutMs must be a positive finite number no greater than 2147483647')
    }
    const seen: NativeToolDeclaration[] = []
    state.tools.aroundExecution(async (call, tool, next) => { seen.push(tool); return next(call.signal) })
    state.tools.register({ schema: schema('plain'), execute: async () => ok('plain') })
    state.tools.registerValueTool({ schema: schema('valued'), timeoutMs: 25,
      output: { schema: { type: 'string' }, render: (_call, value) => ok(JSON.stringify(value)) }, execute: async () => 'value' })
    await state.tools.execute(state.call('plain'))
    await state.tools.execute(state.call('valued'))
    expect(seen).toEqual([{}, { timeoutMs: 25 }])
    expect(Object.isFrozen(seen[1])).toBe(true)
  })

  it('fuses a replacement signal and lets the outer policy translate a body failure after settlement', async () => {
    const state = fixture()
    const order: string[] = []
    const deadline = new AbortController()
    state.tools.aroundExecution(async (call, _tool, next) => {
      order.push('outer-enter')
      try { return await next(deadline.signal) }
      catch (error: unknown) {
        order.push(`outer-caught:${(error as Error).message}`)
        return { content: [{ type: 'text', text: 'Error: replaced' }], isError: true, error: { name: 'Replaced', code: 'REPLACED' } }
      } finally { expect(call.signal.aborted).toBe(false) }
    })
    state.tools.aroundExecution(async (call, _tool, next) => {
      order.push('inner-enter')
      expect(call.signal.aborted).toBe(false)
      return next(call.signal)
    })
    state.tools.registerValueTool({ schema: schema('slow'),
      output: { schema: { type: 'string' }, render: (_call, value) => ok(JSON.stringify(value)) },
      async execute(call) {
        order.push('body')
        deadline.abort(new Error('deadline'))
        await Promise.resolve()
        expect(call.signal.aborted).toBe(true)
        order.push('body-exit')
        throw new Error('body cancelled')
      } })
    const result = await state.tools.execute(state.call('slow'))
    // A policy-selected failure has no canonical value and still records its structured error.
    expect(result).toEqual({ content: [{ type: 'text', text: 'Error: replaced' }], isError: true, error: { name: 'Replaced', code: 'REPLACED' } })
    expect(order).toEqual(['outer-enter', 'inner-enter', 'body', 'body-exit', 'outer-caught:body cancelled'])
  })

  it('requires exactly one delegation and awaits the body before a replacement returns', async () => {
    const state = fixture()
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    const skip = state.tools.aroundExecution(async () => ok('skipped'))
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('execution policy did not delegate')
    await skip()
    const twice = state.tools.aroundExecution(async (call, _tool, next) => { await next(call.signal); return next(call.signal) })
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('execution policy delegated more than once')
    await twice()
    let settled = false
    const release = Promise.withResolvers<undefined>()
    state.tools.register({ schema: schema('held'), async execute() { await release.promise; settled = true; return ok('held') } })
    state.tools.aroundExecution(async (call, _tool, next) => {
      void next(call.signal)
      return ok('early')
    })
    const running = state.tools.execute(state.call('held'))
    await Promise.resolve()
    release.resolve(undefined)
    expect(await running).toEqual(ok('early'))
    expect(settled).toBe(true)
  })

  it('applies to nested program calls and drains admitted work on removal', async () => {
    const state = fixture()
    const names: string[] = []
    const entered = Promise.withResolvers<undefined>()
    const remove = state.tools.aroundExecution(async (call, _tool, next) => { names.push(call.name); return next(call.signal) })
    state.tools.registerValueTool({ schema: schema('nested'),
      output: { schema: { type: 'string' }, render: (_call, value) => ok(JSON.stringify(value)) },
      async execute(call) {
        entered.resolve(undefined)
        await new Promise<void>((resolve) => { call.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
        call.signal.throwIfAborted()
        return 'never'
      } })
    const run = createNativePtcDispatch(state.tools, { ...state.call('run_code') }, 1)
    const nested = run.dispatch('nested', {})
    await entered.promise
    expect(names).toEqual(['nested'])
    await remove()
    expect((await nested).isError).toBe(true)
    await run.close()
  })
})

describe('settlement policies', () => {
  it('derives detached contexts in registration order from failures and built-in outcomes', () => {
    const state = fixture()
    const seen: NativeToolSettlement[] = []
    state.tools.onSettlement((settlement) => {
      seen.push(settlement)
      return [createUserMessage({ content: [{ type: 'text', text: `first:${settlement.name}` }], source: { kind: 'plugin', plugin: 'first' } })]
    })
    state.tools.onSettlement(() => [createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'plugin', plugin: 'second' } })])
    const argumentsValue = { path: 'x' }
    const contexts = state.tools.settlementContexts({ agent: state.agent, session: state.session, callId: ToolCallId('c'),
      name: 'read_file', arguments: argumentsValue, result: { content: [{ type: 'text', text: 'denied' }], isError: true, error: { name: 'HarnessError', code: 'TOOL_DENIED' } } })
    expect(contexts.map(message => message.content)).toEqual([[{ type: 'text', text: 'first:read_file' }], [{ type: 'text', text: 'second' }]])
    expect(seen[0]?.agent).toBe(state.agent)
    expect(seen[0]?.session).toBe(state.session)
    expect(seen[0]?.arguments).not.toBe(argumentsValue)
    expect(Object.isFrozen(seen[0]?.arguments)).toBe(true)
    expect(Object.isFrozen(seen[0]?.result)).toBe(true)
    expect(Object.isFrozen(state.agent)).toBe(false)
  })

  it('rejects non-user context and unregistered Agents, and removes policies exactly', () => {
    const state = fixture()
    const settlement = { agent: state.agent, session: state.session, callId: ToolCallId('c'), name: 'tool', arguments: {}, result: ok('done') }
    const remove = state.tools.onSettlement(() => [{ role: 'assistant' } as never])
    expect(() => state.tools.settlementContexts(settlement)).toThrow('settlement policies may only add user messages')
    remove()
    remove()
    expect(state.tools.settlementContexts(settlement)).toEqual([])
    const stranger = { id: NativeAgentId('stranger'), scope: state.scope }
    expect(() => state.tools.settlementContexts({ ...settlement, agent: stranger })).toThrow('is not registered')
  })

  it('adds nested program settlement contexts before the nested result contexts', async () => {
    const state = fixture()
    state.tools.onSettlement(settlement => [createUserMessage({ content: [{ type: 'text', text: `seen ${settlement.name}` }], source: { kind: 'plugin', plugin: 'observer' } })])
    state.tools.registerProjectedTool({ schema: schema('nested'),
      output: { schema: { type: 'string' }, render: (_call, value) => ok(JSON.stringify(value)) },
      execute: async () => ({ value: 'v', additionalContexts: [createUserMessage({ content: [{ type: 'text', text: 'own' }], source: { kind: 'plugin', plugin: 'tool' } })] }) })
    const run = createNativePtcDispatch(state.tools, state.call('run_code'), 1)
    await run.dispatch('nested', {})
    await run.close()
    expect(run.additionalContexts.map(message => message.content)).toEqual([[{ type: 'text', text: 'seen nested' }], [{ type: 'text', text: 'own' }]])
  })

  it('closes settlement registration with the registry', async () => {
    const state = fixture()
    const policy = vi.fn(() => [])
    state.tools.onSettlement(policy)
    await state.tools.clear()
    expect(() => state.tools.onSettlement(policy)).toThrow('registry is disposed')
    expect(() => state.tools.aroundExecution(async (call, _tool, next) => next(call.signal))).toThrow('registry is disposed')
    expect(() => state.tools.settlementContexts({ agent: state.agent, session: state.session, callId: ToolCallId('c'), name: 'x', arguments: {}, result: ok('') }))
      .toThrow('registry is disposed')
    expect(policy).not.toHaveBeenCalled()
  })
})
