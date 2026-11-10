/** Ordered pre/post tool interception points over the scoped registry. */
import { describe, expect, it } from 'vitest'
import { NativeScope } from '@redspark/rsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@redspark/rsh-native-agent'
import { createUserMessage, ToolCallId } from '@redspark/rsh-llm/native'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@redspark/rsh-session/native'
import { NativeToolRegistry, type NativeToolExecution, type NativeToolPostDecision,
  type NativeToolPreDecision, type NativeToolResult } from '../src/index.ts'

function fixture() {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId('interception-owner'), scope }
  agents.register(agent)
  const tools = new NativeToolRegistry(agents, scope)
  const id = SessionId('interception-session')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: '/' })
  const events: SessionEvent[] = []
  const call = (name: string, args: unknown = {}): NativeToolExecution => ({
    agent, session, name, callId: ToolCallId(`call-${name}`), arguments: args, signal: new AbortController().signal,
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

describe('pre-tool interception', () => {
  it('delegates through every interceptor and runs the body when all allow', async () => {
    const state = fixture()
    const order: string[] = []
    state.tools.interceptBeforeCall(async (call, next) => { order.push('outer:' + call.name); return next() })
    state.tools.interceptBeforeCall(async (call, next) => { order.push('inner:' + call.name); return next() })
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    expect(await state.tools.execute(state.call('tool'))).toEqual(ok('body'))
    expect(order).toEqual(['outer:tool', 'inner:tool'])
  })

  it('denies without running the body and reports the reason', async () => {
    const state = fixture()
    let bodyRan = false
    state.tools.interceptBeforeCall(async () => ({ kind: 'deny', reason: 'bash is disabled by policy in this session' }))
    state.tools.register({ schema: schema('bash'), execute: async () => { bodyRan = true; return ok('never') } })
    await expect(state.tools.execute(state.call('bash'))).rejects.toThrow('bash is disabled by policy in this session')
    expect(bodyRan).toBe(false)
  })

  it('lets a later interceptor answer after an earlier one delegates', async () => {
    const state = fixture()
    state.tools.interceptBeforeCall(async (_call, next) => next())
    state.tools.interceptBeforeCall(async () => ({ kind: 'deny', reason: 'inner said no' }))
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('inner said no')
  })

  it('replaces the arguments the body receives and validates the replacement', async () => {
    const state = fixture()
    const received: unknown[] = []
    state.tools.interceptBeforeCall(async (_call, next) => {
      const decision = await next()
      return decision.kind === 'allow' ? { ...decision, arguments: { path: 'rewritten.txt' } } : decision
    })
    state.tools.register({ schema: schema('read_file'), execute: async (call) => { received.push(call.arguments); return ok('read') } })
    await state.tools.execute(state.call('read_file', { path: 'original.txt' }))
    expect(received).toEqual([{ path: 'rewritten.txt' }])
  })

  it('rejects a replacement that is not lossless JSON', async () => {
    const state = fixture()
    state.tools.interceptBeforeCall(async () => ({ kind: 'allow', arguments: { value: 1n } }))
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('non-lossless JSON arguments')
  })

  it('asks the application and runs the body only for a grant', async () => {
    const state = fixture()
    let bodyRan = 0
    state.tools.interceptBeforeCall(async () => ({ kind: 'ask', reason: 'bash requires manual approval in this session' }))
    state.tools.register({ schema: schema('bash'), execute: async () => { bodyRan += 1; return ok('body') } })
    const denied = { ...state.call('bash'), requestApproval: async () => 'rejected' as const }
    await expect(state.tools.execute(denied)).rejects.toThrow('the user rejected tool "bash"')
    const granted = { ...state.call('bash'), requestApproval: async () => 'allowed-once' as const }
    expect(await state.tools.execute(granted)).toEqual(ok('body'))
    expect(bodyRan).toBe(1)
  })

  it('denies an ask when no approval channel exists', async () => {
    const state = fixture()
    state.tools.interceptBeforeCall(async () => ({ kind: 'ask' }))
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('no approval channel is available')
  })

  it('reports both a listener failure and a delegated failure it observed', async () => {
    const state = fixture()
    state.tools.interceptBeforeCall(async (_call, next) => {
      await expect(next()).rejects.toThrow('inner interceptor failed')
      throw new Error('outer interceptor failed')
    })
    state.tools.interceptBeforeCall(async () => { throw new Error('inner interceptor failed') })
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    const failure = state.tools.execute(state.call('tool'))
    await expect(failure).rejects.toBeInstanceOf(AggregateError)
    await expect(failure).rejects.toMatchObject({ message: 'tool interceptors failed' })
  })

  it('propagates a delegated failure when the answering listener did not fail', async () => {
    const state = fixture()
    state.tools.interceptBeforeCall(async (_call, next) => { await next().catch(() => undefined); return { kind: 'allow' } })
    state.tools.interceptBeforeCall(async () => { throw new Error('inner interceptor failed') })
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('inner interceptor failed')
  })

  it('fails loud when an interceptor delegates twice or skips delegation in the wrong order', async () => {
    const state = fixture()
    const twice = state.tools.interceptBeforeCall(async (_call, next) => { await next(); return next() })
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('interceptor delegated more than once')
    await twice()
  })
})

describe('post-tool interception', () => {
  it('passes a result through every interceptor unchanged', async () => {
    const state = fixture()
    const seen: string[] = []
    state.tools.interceptAfterCall(async (call, next) => { seen.push('outer:' + call.name); return next() })
    state.tools.interceptAfterCall(async (call, next) => { seen.push('inner:' + call.name); return next() })
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    expect(await state.tools.execute(state.call('tool'))).toEqual(ok('body'))
    expect(seen).toEqual(['outer:tool', 'inner:tool'])
  })

  it('blocks a result into a failure carrying the corrective feedback', async () => {
    const state = fixture()
    state.tools.interceptAfterCall(async () => ({
      kind: 'block', feedback: [{ type: 'text', text: 'tool output rejected by policy: retry once' }],
    }))
    state.tools.register({ schema: schema('bash'), execute: async () => ok('HELLO') })
    const result = await state.tools.execute(state.call('bash'))
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'tool output rejected by policy: retry once' }])
    expect(result.error).toEqual({ name: 'HarnessError', code: 'TOOL_INTERCEPTED' })
  })

  it('attaches decision contexts after the result own contexts', async () => {
    const state = fixture()
    const own = createUserMessage({ content: [{ type: 'text', text: 'own' }], source: { kind: 'plugin', plugin: 'tool' } })
    const added = createUserMessage({ content: [{ type: 'text', text: 'interceptor' }], source: { kind: 'plugin', plugin: 'hook' } })
    state.tools.interceptAfterCall(async () => ({ kind: 'pass', additionalContexts: [added] }))
    state.tools.register({ schema: schema('tool'), execute: async () => ({ ...ok('body'), additionalContexts: [own] }) })
    const result = await state.tools.execute(state.call('tool'))
    expect(result.additionalContexts).toEqual([own, added])
  })

  it('rejects non-user context and empty feedback', async () => {
    const state = fixture()
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    const bad = state.tools.interceptAfterCall(async () => ({ kind: 'pass', additionalContexts: [{ role: 'assistant' } as never] }))
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('may only add user messages')
    await bad()
    const empty = state.tools.interceptAfterCall(async (): Promise<NativeToolPostDecision> => ({ kind: 'block', feedback: [] }))
    await expect(state.tools.execute(state.call('tool'))).rejects.toThrow('must carry corrective feedback')
    await empty()
  })

  it('runs before result policies so a block replaces the policy input', async () => {
    const state = fixture()
    const observed: boolean[] = []
    state.tools.interceptAfterCall(async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'blocked' }] }))
    state.tools.postResult(async (_call, original, next) => { observed.push(original.isError); return next() })
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    const result = await state.tools.execute(state.call('tool'))
    expect(observed).toEqual([true])
    expect(result.isError).toBe(true)
  })
})

describe('interception lifecycle', () => {
  it('closes registration with the registry and disposes installed interceptors', async () => {
    const state = fixture()
    const pre: NativeToolPreDecision = { kind: 'allow' }
    const removePre = state.tools.interceptBeforeCall(async () => pre)
    const removePost = state.tools.interceptAfterCall(async (_call, next) => next())
    await removePre()
    await removePost()
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    expect(await state.tools.execute(state.call('tool'))).toEqual(ok('body'))
    await state.tools.clear()
    expect(() => state.tools.interceptBeforeCall(async () => pre)).toThrow('registry is disposed')
    expect(() => state.tools.interceptAfterCall(async (_call, next) => next())).toThrow('registry is disposed')
  })

  it('cancels and drains an interception its disposer removes', async () => {
    const state = fixture()
    const entered = Promise.withResolvers<undefined>()
    const remove = state.tools.interceptBeforeCall(async (_call, next) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
      return next()
    })
    let bodyRan = false
    state.tools.register({ schema: schema('tool'), execute: async () => { bodyRan = true; return ok('body') } })
    const running = state.tools.execute(state.call('tool'))
    await entered.promise
    await remove()
    await expect(running).rejects.toThrow()
    expect(bodyRan).toBe(false)
  })

  it('carries the invocation turn into both decisions', async () => {
    const state = fixture()
    const seen: (number | undefined)[] = []
    state.tools.interceptBeforeCall(async (call, next) => { seen.push(call.turn); return next() })
    state.tools.interceptAfterCall(async (call, next) => { seen.push(call.turn); return next() })
    state.tools.register({ schema: schema('tool'), execute: async () => ok('body') })
    await state.tools.execute({ ...state.call('tool'), turn: 7 })
    expect(seen).toEqual([7, 7])
  })
})
