/** Native human commands use exact Program routing and durable command pairing. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentId } from '@deepseek-ai/dsh-attachment/brand'
import { expect, it } from 'vitest'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeActiveSessionRegistry, type NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { NativeCommandRegistry } from '../src/native.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-goal-'))
  const storage = new JsonlSessionBackend({ root, compression: 'none' })
  const header = { id: SessionId('goal-parent'), version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false,
    delegationDepth: 0, cwd: root } as const
  const writer = await storage.create(header)
  const session = Session.create(header.id, undefined, header)
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId(header.id), scope: new NativeScope() }
  agents.register(agent)
  const active = new NativeActiveSessionRegistry(agents)
  const commands = new NativeCommandRegistry(agent.scope, agents, active, new AbortController().signal)
  const pending: SessionEvent[] = []
  const observers = new Set<(event: SessionEvent) => void>()
  let leases = 0
  const owner: NativeActiveSessionOwner = { agent, session, invocation: 'root', inheritedEventCount: 0, writerAvailable: true,
    append(type, data, ...options) {
      const event = session.append(type, data, ...options)
      pending.push(event as SessionEvent)
      return event
    },
    appendBatch(inputs) { const events = session.appendBatch(inputs); pending.push(...events); return events },
    async flush() {
      const events = pending.splice(0)
      if (events.length > 0) await writer.append(events)
      await writer.flush()
      for (const event of events) for (const observer of observers) observer(event)
    },
    async readEvents() { await owner.flush(); return (await writer.read()).events },
    messages() { return [] }, async enqueue(message) { return message.id }, async remove() {},
    retain() { leases++; let released = false; return () => { if (!released) { released = true; leases-- } } },
    onEvent(observer) { observers.add(observer); return () => { observers.delete(observer) } },
    onIdle() { return async () => {} }, beforeStep() { return async () => {} },
  }
  let release: (() => Promise<void>) | undefined
  return { owner, writer, session, agent, commands, active, root, storage, get leases() { return leases },
    async attach() { release = await active.register(owner) }, async detach() { await release?.(); release = undefined },
    async close() { await commands.dispose(); await active.dispose(); await agents.dispose(); await writer.close(); await storage.close()
      await rm(root, { recursive: true }) },
  }
}



it('persists exact human input and command outcomes without admitting a model-visible user message', async () => {
  const state = await fixture()
  const seen: string[] = []
  const release = state.commands.register({ name: 'goal', description: 'Human objective.', handler: async (invocation) => {
    const events = await invocation.owner.readEvents()
    expect(events.at(-1)).toMatchObject({ type: 'command/run', data: { commandId: invocation.commandId } })
    seen.push(invocation.rawInput)
    return { kind: 'success', text: 'Direct UI only.' }
  } })
  try {
    await state.attach()
    const result = await state.commands.dispatch({ agent: state.agent, session: state.session, line: '/goal  exact input  ',
      attachments: [], signal: new AbortController().signal })
    expect(result).toMatchObject({ result: { kind: 'success', text: 'Direct UI only.' } })
    expect(seen).toEqual(['  exact input  '])
    const events = (await state.writer.read()).events
    expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(events[0]).toMatchObject({ data: { args: '  exact input  ', source: { kind: 'user' } } })
    expect(events[1]).toMatchObject({ data: { commandId: result?.commandId } })
    expect(await state.commands.dispatch({ agent: state.agent, session: state.session, line: '/missing', attachments: [],
      signal: new AbortController().signal })).toBeUndefined()
    expect(state.commands.parse('/goalx! wrong')).toBeUndefined()
    expect(state.commands.parse('ordinary prompt')).toBeUndefined()
    expect(state.commands.list(state.agent.scope)).toEqual([{ name: 'goal', description: 'Human objective.' }])
    await expect(state.commands.dispatch({ agent: { ...state.agent }, session: state.session, line: '/goal', attachments: [],
      signal: new AbortController().signal })).rejects.toThrow('Agent is not live')
  } finally { await release(); await state.close() }
})

it('closes handler admission immediately but awaits cancellation cleanup before unregister settles', async () => {
  const state = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const cleaning = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const release = state.commands.register({ name: 'slow', description: 'Drain cleanup.', handler: async (invocation) => {
    entered.resolve(undefined)
    await new Promise<void>((resolve) =>{  invocation.signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
    cleaning.resolve(undefined)
    await finish.promise
    return { kind: 'success', text: 'Unreachable success after cancellation.' }
  } })
  try {
    await state.attach()
    const invocation = state.commands.dispatch({ agent: state.agent, session: state.session, line: '/slow', attachments: [],
      signal: new AbortController().signal })
    await entered.promise
    let released = false
    const disposing = release().then(() => { released = true })
    await cleaning.promise
    expect(released).toBe(false)
    expect(state.commands.list(state.agent.scope)).toEqual([])
    finish.resolve(undefined)
    await disposing
    expect(await invocation).toMatchObject({ result: { kind: 'error', text: 'Command /slow unloaded' } })
    expect((await state.writer.read()).events.at(-1)).toMatchObject({ type: 'command/done', data: { kind: 'error' } })
  } finally { finish.resolve(undefined); await release(); await state.close() }
})

it('refuses delegated invocation authority and rejects undeclared attachments before handler admission', async () => {
  const state = await fixture()
  let calls = 0
  const release = state.commands.register({ name: 'direct', description: 'Direct human only.', handler: () => {
    calls++; return { kind: 'success' }
  } })
  try {
    await state.attach()
    await expect(state.commands.dispatch({ agent: state.agent, session: state.session, line: '/direct',
      attachments: [{ type: 'image', attachment: { attachmentId: AttachmentId('image-fixture'), mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }],
      signal: new AbortController().signal })).resolves.toMatchObject({ result: { kind: 'error' } })
    expect(calls).toBe(0)
    await state.detach()
    const { owner } = state
    await state.active.register({ ...owner, invocation: 'delegated' })
    await expect(state.commands.dispatch({ agent: state.agent, session: state.session, line: '/direct', attachments: [],
      signal: new AbortController().signal })).rejects.toThrow('exact root Session owner')
  } finally { await release(); await state.close() }
})
