/** Nested dispatch cancellation over the real scoped registry and Session. */
import { expect, it, vi } from 'vitest'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
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
