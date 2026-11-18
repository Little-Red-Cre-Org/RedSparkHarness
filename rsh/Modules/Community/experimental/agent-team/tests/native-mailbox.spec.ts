/** Native Team mailbox admission, dispatch ordering, acknowledgement, and recovery. */
import { expect, it, vi } from 'vitest'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { Session, SessionEvent } from '@redspark/rsh-session/native'
import { SessionId } from '@redspark/rsh-session/native'
import { NativeTeamMailbox } from '../src/native-mailbox.ts'
import type { NativeTeamRoster } from '../src/native-roster.ts'
import type { TeamState } from '../src/projection.ts'
import { TeamId, TeamMessageId, type TeamMessageSnapshot } from '../src/types.ts'

const signal = new AbortController().signal
const root = { id: SessionId('lead'), agent: { id: 'lead' } }
const lead = { id: SessionId('lead'), name: 'lead' }
const worker = { id: SessionId('worker'), name: 'worker' }

function member(id: SessionId, name: string) {
  return {
    id, name, description: name, provider: 'spawn', context: 'fresh' as const, phase: 'active' as const,
  }
}

function makeState(messages: TeamMessageSnapshot[] = [], delivered: TeamMessageSnapshot['id'][] = []): TeamState {
  return {
    id: TeamId('lead'), members: [member(worker.id, 'worker')], tasks: [],
    messages, delivered, nextTaskNumber: 1,
  }
}

function message(id: string, targetId = worker.id): TeamMessageSnapshot {
  return {
    id: TeamMessageId(id), senderId: lead.id, senderName: 'lead', targetId,
    content: [{ type: 'text', text: 'hello' }],
  }
}

function setup(options: {
  state?: TeamState
  disposed?: boolean
  role?: 'lead' | 'teammate'
  owner?: NativeActiveSessionOwner
  persistedEvents?: readonly SessionEvent[]
  persistedThrows?: boolean
  maxPending?: number
  maxBytes?: number
  appendThrows?: boolean
} = {}) {
  const state = options.state ?? makeState()
  const appended: string[] = []
  const warn = vi.fn()
  const sendMessage = vi.fn(async () => 'message-id' as never)
  const journal = {
    state: () => state,
    transact: async (_id: SessionId, operation: () => Promise<unknown>) => await operation(),
    async appendAndFlush(_root: unknown, type: string, data: unknown) {
      if (options.appendThrows) throw new Error('append failed')
      appended.push(type)
      if (type === 'team/message/queued') state.messages.push((data as { message: TeamMessageSnapshot }).message)
      if (type === 'team/message/delivered') state.delivered.push((data as { messageId: TeamMessageSnapshot['id'] }).messageId)
    },
  }
  const membership = (_agent: NativeAgent) => ({
    root: root as never, id: TeamId('lead'), role: options.role ?? 'lead',
    name: (options.role ?? 'lead') === 'lead' ? 'lead' : 'worker',
  })
  const roster = {
    membership,
    tryMembership: () => membership({} as NativeAgent),
  } as unknown as NativeTeamRoster
  const persistence = {
    open: async () => {
      if (options.persistedThrows) throw new Error('read failed')
      return {
        header: { id: SessionId('worker') },
        inheritedEventCount: 0,
        read: async () => ({ events: options.persistedEvents ?? [] }),
        close: async () => {},
      }
    },
  }
  const mailbox = new NativeTeamMailbox({
    subagents: { sendMessage } as never,
    persistence: persistence as never,
    journal: journal as never,
    roster,
    lifecycle: { disposed: options.disposed ?? false, signal: new AbortController().signal } as never,
    maxPendingMessagesPerMember: options.maxPending ?? 4,
    maxMessageBytes: options.maxBytes ?? 10_000,
    ownerOfSession: id => options.owner?.session.id === id ? options.owner : undefined,
    warn,
  })
  return { mailbox, state, appended, warn, sendMessage, journal }
}

function session(events: SessionEvent[]): Session {
  return { id: SessionId('worker'), inheritedEventCount: 0, snapshotEvents: () => events } as unknown as Session
}

function liveOwner(events: SessionEvent[], enqueue = true): NativeActiveSessionOwner {
  return {
    agent: { id: 'worker' },
    session: session(events),
    async enqueue(input: { id: string }) {
      if (!enqueue) throw new Error('enqueue failed')
      events.push({ type: 'user/message', data: input } as unknown as SessionEvent)
      return input.id
    },
  } as unknown as NativeActiveSessionOwner
}

it('rejects disposed, aborted, self, unknown, full, and oversized sends', async () => {
  await expect(setup({ disposed: true }).mailbox.send({} as NativeAgent, {
    target: 'worker', content: [], signal,
  })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })

  const aborted = new AbortController()
  aborted.abort(new Error('stop'))
  await expect(setup().mailbox.send({ id: 'lead' } as NativeAgent, {
    target: 'worker', content: [], signal: aborted.signal,
  })).rejects.toThrow('stop')

  await expect(setup().mailbox.send({ id: 'lead' } as NativeAgent, {
    target: 'lead', content: [], signal,
  })).rejects.toMatchObject({ code: 'TEAM_SELF_MESSAGE' })

  await expect(setup().mailbox.send({ id: 'lead' } as NativeAgent, {
    target: 'missing', content: [], signal,
  })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })

  await expect(setup({ state: makeState([message('pending')]), maxPending: 1 }).mailbox.send({ id: 'lead' } as NativeAgent, {
    target: 'worker', content: [], signal,
  })).rejects.toMatchObject({ code: 'TEAM_MAILBOX_FULL' })

  await expect(setup({ maxBytes: 1 }).mailbox.send({ id: 'lead' } as NativeAgent, {
    target: 'worker', content: [{ type: 'text', text: 'long' }], signal,
  })).rejects.toMatchObject({ code: 'TEAM_MESSAGE_TOO_LARGE' })
})

it('delivers to a live owner and records the durable acknowledgement', async () => {
  const events: SessionEvent[] = []
  const state = setup({ owner: liveOwner(events) })
  const sent = await state.mailbox.send({ id: 'lead' } as NativeAgent, {
    target: 'worker', content: [{ type: 'text', text: 'hello' }], signal,
  })
  expect(sent.status).toBe('accepted')
  expect(events).toHaveLength(1)
  expect(state.state.delivered).toEqual([sent.messageId])
})

it('keeps a failed live delivery queued', async () => {
  const state = setup({ owner: liveOwner([], false) })
  const sent = await state.mailbox.send({ id: 'lead' } as NativeAgent, {
    target: 'worker', content: [], signal,
  })
  expect(sent.status).toBe('queued')
  expect(state.warn).toHaveBeenCalledWith(expect.stringContaining('remains queued'))
})

it('uses the persisted target and cold resume when no owner is active', async () => {
  const recorded = setup({ state: makeState([message('known')]), persistedEvents: [{ type: 'user/message', data: { source: {
    kind: 'team-message', messageId: TeamMessageId('known'),
  } } } as unknown as SessionEvent] })
  const internals = recorded.mailbox as unknown as {
    dispatchOnce: (root: unknown, message: TeamMessageSnapshot, signal: AbortSignal) => Promise<boolean>
  }
  expect(await internals.dispatchOnce(root, message('known'), signal)).toBe(true)
  expect(recorded.sendMessage).not.toHaveBeenCalled()
  expect(recorded.state.delivered).toEqual([TeamMessageId('known')])

  const cold = setup()
  expect(await (cold.mailbox as unknown as typeof internals).dispatchOnce(root, message('cold'), signal)).toBe(true)
  expect(cold.sendMessage).toHaveBeenCalled()

  const unreadable = setup({ persistedThrows: true })
  expect(await (unreadable.mailbox as unknown as typeof internals).dispatchOnce(root, message('unreadable'), signal)).toBe(false)
  expect(unreadable.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read Team message target'))
})

it('reconciles already recorded deliveries and ignores foreign acknowledgement rows', async () => {
  const events: SessionEvent[] = [{ type: 'user/message', data: { source: {
    kind: 'team-message', messageId: TeamMessageId('known'),
  } } } as unknown as SessionEvent]
  const state = setup({ owner: liveOwner(events) })
  const internals = state.mailbox as unknown as {
    dispatchOnce: (root: unknown, message: TeamMessageSnapshot, signal: AbortSignal) => Promise<boolean>
    dispatchThrough: (root: unknown, message: TeamMessageSnapshot, signal: AbortSignal) => Promise<boolean>
    checkpointDelivered: (agent: NativeAgent, target: Session, messageId: TeamMessageId) => Promise<boolean>
    markDelivered: (root: unknown, messageId: TeamMessageId, targetId: SessionId) => Promise<void>
  }
  expect(await internals.dispatchOnce(root, message('known'), signal)).toBe(true)
  expect(await internals.dispatchThrough(root, message('absent'), signal)).toBe(false)
  state.state.messages.push(message('present'))
  expect(await internals.dispatchThrough(root, message('present'), signal)).toBe(true)
  expect(await internals.dispatchThrough(root, message('present'), signal)).toBe(true)
  expect(await internals.checkpointDelivered({} as NativeAgent, session([]), TeamMessageId('known'))).toBe(false)
  await internals.markDelivered(root, TeamMessageId('present'), worker.id)
  await internals.markDelivered(root, TeamMessageId('unknown'), worker.id)
  await internals.markDelivered(root, TeamMessageId('present'), SessionId('other'))
})

it('retries pending messages for the Lead and only the addressed teammate', async () => {
  const events: SessionEvent[] = []
  const state = setup({
    owner: liveOwner(events),
    state: makeState([message('for-worker'), message('for-other', SessionId('other'))]),
  })
  await state.mailbox.recoverFor({ id: 'lead' } as NativeAgent, signal)
  expect(state.state.delivered).toContain(TeamMessageId('for-worker'))
  expect(state.state.delivered).toContain(TeamMessageId('for-other'))

  const teammate = setup({
    role: 'teammate',
    owner: liveOwner(events),
    state: makeState([message('for-worker'), message('for-other', SessionId('other'))]),
  })
  await teammate.mailbox.recoverFor({ id: 'worker' } as NativeAgent, signal)
  expect(teammate.state.delivered).toEqual([TeamMessageId('for-worker')])

  const unknown = setup()
  ;(unknown.mailbox as unknown as { deps: { roster: { tryMembership: () => undefined } } })
    .deps.roster.tryMembership = () => undefined
  await unknown.mailbox.recoverFor({ id: 'stranger' } as NativeAgent, signal)

  const aborted = new AbortController()
  aborted.abort(new Error('stop'))
  await expect(unknown.mailbox.recoverFor({ id: 'lead' } as NativeAgent, aborted.signal)).rejects.toThrow('stop')
})

it('acknowledges target receipts and contains acknowledgement failures', async () => {
  const events: SessionEvent[] = [{ type: 'user/message', data: { source: {
    kind: 'team-message', messageId: TeamMessageId('known'),
  } } } as unknown as SessionEvent]
  const state = setup({ owner: liveOwner(events), state: makeState([message('known')]) })
  for (const event of [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user' } } },
  ] as unknown as SessionEvent[]) {
    state.mailbox.observeSessionEvent(liveOwner(events), event)
  }
  state.mailbox.observeSessionEvent(liveOwner(events), events[0]!)
  await vi.waitFor(() => { expect(state.state.delivered).toContain(TeamMessageId('known')) })

  const disposed = setup({ disposed: true })
  disposed.mailbox.observeSessionEvent(liveOwner(events), events[0]!)

  const unresolved = setup({ state: makeState([message('known')]) })
  ;(unresolved.mailbox as unknown as { deps: { roster: { tryMembership: () => undefined } } })
    .deps.roster.tryMembership = () => undefined
  unresolved.mailbox.observeSessionEvent(liveOwner(events), events[0]!)
  await vi.waitFor(() => { expect(unresolved.state.delivered).toEqual([]) })

  const failing = setup({ owner: liveOwner(events), appendThrows: true, state: makeState([message('known')]) })
  failing.mailbox.observeSessionEvent(liveOwner(events), events[0]!)
  await vi.waitFor(() => {
    expect(failing.warn).toHaveBeenCalledWith(expect.stringContaining('acknowledgement failed'))
  })
})

it('coalesces concurrent dispatch for one target', async () => {
  const events: SessionEvent[] = []
  const state = setup({ owner: liveOwner(events) })
  const internals = state.mailbox as unknown as {
    tryDispatch: (root: unknown, message: TeamMessageSnapshot, signal: AbortSignal) => Promise<boolean>
  }
  const first = internals.tryDispatch(root, message('one'), signal)
  const second = internals.tryDispatch(root, message('one'), signal)
  expect(await second).toBe(false)
  expect(await first).toBe(false)
  state.state.messages.push(message('one'))
  const third = internals.tryDispatch(root, message('one'), signal)
  const fourth = internals.tryDispatch(root, message('one'), signal)
  expect(await fourth).toBe(false)
  expect(await third).toBe(true)
  expect(state.mailbox.pendingDispatches()).toEqual([])
})

it('skips dispatch after disposal and replaces the target tail across concurrent attempts', async () => {
  const state = setup({ disposed: true })
  const internals = state.mailbox as unknown as {
    tryDispatch: (root: unknown, message: TeamMessageSnapshot, signal: AbortSignal) => Promise<boolean>
    serializeDispatch: (message: TeamMessageSnapshot, operation: () => Promise<boolean>) => Promise<boolean>
  }
  expect(await internals.tryDispatch(root, message('one'), signal)).toBe(false)

  const fresh = setup()
  const dispatch = fresh.mailbox as unknown as typeof internals
  const gate = Promise.withResolvers<undefined>()
  const first = dispatch.serializeDispatch(message('one'), async () => { await gate.promise; return true })
  const second = dispatch.serializeDispatch(message('two'), async () => true)
  gate.resolve(undefined)
  expect(await first).toBe(true)
  expect(await second).toBe(true)
  await expect(dispatch.serializeDispatch(message('boom'), async () => { throw new Error('boom') }))
    .rejects.toThrow('boom')
})
