/** Nested dispatch cancellation over the real scoped registry and Session. */
import { expect, it, vi } from 'vitest'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { NativeToolRegistry, type NativeToolExecution } from '../src/index.ts'
import { createNativePtcDispatch } from '../src/ptc-dispatch.ts'


function fixture() {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId('ptc-owner'), scope }
  const release = agents.register(agent)
  const tools = new NativeToolRegistry(agents, scope)
  const id = SessionId('ptc-session')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: '/' })
  const events: SessionEvent[] = []
  const approvals: string[] = []
  const parent: NativeToolExecution = {
    agent, session, name: 'run_code', callId: ToolCallId('parent'), arguments: {}, signal: new AbortController().signal,
    appendEvent: async (type, data, ...opts) => {
      const event = session.append(type, data, ...opts)
      events.push(event as SessionEvent)
      return event
    },
    approvalAuthority: {
      request: async () => 'allowed-once',
      authorize: async (call) => { approvals.push(`${call.toolName}:${call.callId}`) },
    },
  }
  return { tools, release, events, approvals, parent }
}

it('cancels and drains an admitted body while abandoning unstarted calls without start records', async () => {
  const state = fixture()
  let entered = false
  let exited = false
  state.tools.registerValueTool({
    schema: { name: 'wait', description: 'wait', parameters: {} },
    output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
    async execute(call) {
      entered = true
      await new Promise<void>((resolve) => { call.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      exited = true
      call.signal.throwIfAborted()
      return 'done'
    },
  })
  const run = createNativePtcDispatch(state.tools, state.parent, 1)
  try {
    const first = run.dispatch('wait', {})
    const second = run.dispatch('wait', {})
    const rejected = expect(second).rejects.toThrow('abandoned')
    await vi.waitFor(() => { expect(entered).toBe(true) })
    await run.close()
    expect(exited).toBe(true)
    expect((await first).isError).toBe(true)
    await rejected
    expect(state.events.map(event => event.type)).toEqual(['tool/ptc-dispatch-start', 'tool/ptc-dispatch'])
    await expect(run.dispatch('wait', {})).rejects.toThrow('closed')
  } finally { await run.close(); await state.tools.clear(); await state.release() }
})

it('dispatches and accepts through the exact captured program registration', async () => {
  const state = fixture()
  const entered: string[] = []
  const completed: string[] = []
  const executed: NativeToolExecution[] = []
  const accepted: NativeToolExecution[] = []
  const firstGate = Promise.withResolvers<undefined>()
  const secondGate = Promise.withResolvers<undefined>()
  const firstName = 'business-first'
  const secondName = 'business-second'
  const registerBusiness = (name: string, waitForRelease: () => Promise<void>) => state.tools.registerValueTool({
    schema: { name, description: 'Business tool.', parameters: {} },
    output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
    isConcurrencySafe: () => true,
    async execute(call) {
      executed.push(call)
      entered.push(name)
      await waitForRelease()
      completed.push(name)
      return name
    },
  })
  let replacementExecutions = 0
  let snapshot: ReturnType<typeof state.tools.captureProgramSnapshot> | undefined
  let run: ReturnType<typeof createNativePtcDispatch> | undefined
  try {
    const removeFirst = registerBusiness(firstName, () => firstGate.promise)
    registerBusiness(secondName, () => secondGate.promise)
    state.tools.onResult((call) => { accepted.push(call) })
    state.tools.onSettlement(({ name }) => [
      createUserMessage({ content: [{ type: 'text', text: 'settled:' + name }], source: { kind: 'plugin', plugin: 'test' } }),
    ])
    snapshot = state.tools.captureProgramSnapshot([firstName, secondName], state.parent.agent.scope)
    run = createNativePtcDispatch(state.tools, { ...state.parent, programSnapshot: snapshot }, 2)
    expect(snapshot.programSchemas?.map(schema => schema.name)).toEqual([firstName, secondName])

    const first = run.dispatch(firstName, {})
    const second = run.dispatch(secondName, {})
    await vi.waitFor(() => { expect(entered).toHaveLength(2) })
    expect([...entered].sort()).toEqual([firstName, secondName].sort())

    secondGate.resolve(undefined)
    await vi.waitFor(() => { expect(completed).toEqual([secondName]) })
    expect(accepted).toEqual([])

    firstGate.resolve(undefined)
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect([firstResult.value, secondResult.value]).toEqual([firstName, secondName])
    await vi.waitFor(() => { expect(accepted).toHaveLength(2) })

    await removeFirst()
    state.tools.registerValueTool({
      schema: { name: firstName, description: 'Replacement tool.', parameters: {} },
      output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
      async execute() { replacementExecutions += 1; return 'replacement' },
    })
    const denied = await run.dispatch(firstName, {})
    expect(denied).toEqual({
      content: [{ type: 'text', text: 'native-tools: tool ' + firstName + ' is no longer visible' }],
      isError: true,
      error: { name: 'HarnessError', code: 'TOOL_DENIED' },
    })

    await run.close()
    expect(completed).toEqual([secondName, firstName])
    expect(accepted.map(call => call.name)).toEqual([firstName, secondName])
    expect(accepted[0]).toBe(executed[0])
    expect(accepted[1]).toBe(executed[1])
    expect(replacementExecutions).toBe(0)

    const starts = state.events.filter(event => event.type === 'tool/ptc-dispatch-start')
    const settlements = state.events.filter(event => event.type === 'tool/ptc-dispatch')
    expect(state.events.map(event => event.type)).toEqual([
      'tool/ptc-dispatch-start', 'tool/ptc-dispatch-start',
      'tool/ptc-dispatch', 'tool/ptc-dispatch',
      'tool/ptc-dispatch-start', 'tool/ptc-dispatch',
    ])
    expect(starts.map(event => event.data.name)).toEqual([firstName, secondName, firstName])
    expect(settlements.map(event => event.data.name)).toEqual([firstName, secondName, firstName])
    expect(settlements.map(event => event.data.isError)).toEqual([false, false, true])
    expect(run.additionalContexts.map(message => message.content)).toEqual([
      [{ type: 'text', text: 'settled:' + firstName }],
      [{ type: 'text', text: 'settled:' + secondName }],
      [{ type: 'text', text: 'settled:' + firstName }],
    ])
    expect(run.additionalContexts.map(message => message.source)).toEqual([
      { kind: 'plugin', plugin: 'test' },
      { kind: 'plugin', plugin: 'test' },
      { kind: 'plugin', plugin: 'test' },
    ])
  } finally {
    firstGate.resolve(undefined)
    secondGate.resolve(undefined)
    try {
      if (run !== undefined) await run.close()
    } finally {
      try {
        if (snapshot !== undefined) await snapshot.dispose()
      } finally {
        try { await state.tools.clear() }
        finally { await state.release() }
      }
    }
  }
})
