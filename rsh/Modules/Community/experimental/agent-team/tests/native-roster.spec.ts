/** Native Team roster membership, provisioning recovery, and teardown edges. */
import { expect, it, vi } from 'vitest'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import { NativeAgentId } from '@redspark/rsh-native-agent'
import type { NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { Session, SessionEvent, SessionHeader } from '@redspark/rsh-session/native'
import { SESSION_FORMAT_VERSION, SessionId } from '@redspark/rsh-session/native'
import { NativeTeamRoster } from '../src/native-roster.ts'
import type { TeamState } from '../src/projection.ts'
import { TeamId, type TeamMemberSnapshot } from '../src/types.ts'

type MutableTeamState = { -readonly [K in keyof TeamState]: TeamState[K] }
type TestRoot = { id: SessionId; agent: NativeAgent; session: Session }

const signal = new AbortController().signal
const leadAgent = { id: NativeAgentId('lead') } as NativeAgent
const workerAgent = { id: NativeAgentId('worker') } as NativeAgent

function header(id: string, parentSession?: SessionId): SessionHeader {
  return {
    id: id as SessionId, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false,
    delegationDepth: 0, cwd: '/tmp',
    ...parentSession === undefined ? {} : { parentSession },
  }
}

function session(id: string, parentSession?: SessionId, events: SessionEvent[] = []): Session {
  return {
    id: id as SessionId,
    header: header(id, parentSession),
    inheritedEventCount: 0,
    snapshotEvents: () => events,
    requestHeader: () => ({ config: { model: 'team-model' } }),
  } as unknown as Session
}

function owner(agent: NativeAgent, page: Session, status: 'running' | 'idle' = 'idle'): NativeActiveSessionOwner & { status: string } {
  return { agent, session: page, status } as unknown as NativeActiveSessionOwner & { status: string }
}

function member(id: string, name: string, phase: TeamMemberSnapshot['phase'] = 'active', error?: string): TeamMemberSnapshot {
  return {
    id: id as SessionId, name, description: `${name} description`, provider: 'spawn', context: 'fresh', phase,
    ...error === undefined ? {} : { error },
  }
}

function setup(options: {
  members?: TeamMemberSnapshot[]
  messages?: TeamState['messages']
  disposed?: boolean
  persistence?: unknown
} = {}) {
  const state: MutableTeamState = {
    id: TeamId('lead'), members: options.members ?? [], tasks: [], messages: options.messages ?? [],
    delivered: [], nextTaskNumber: 1,
  }
  const agents = new Map<string, NativeAgent>([[leadAgent.id, leadAgent]])
  const owners = new Map<string, NativeActiveSessionOwner>()
  const roots = new Map<string, TestRoot>()
  const rootSession = session('lead')
  const leadRoot = { id: rootSession.id, agent: leadAgent, session: rootSession }
  roots.set(leadAgent.id, leadRoot)
  const control: { failState?: boolean; failAppend?: boolean; failSettleRead?: boolean } = {}
  const journal = {
    state() {
      if (control.failState) throw new Error('journal failed')
      return state
    },
    transact: async (_id: SessionId, operation: () => Promise<unknown>) => await operation(),
    async appendAndFlush(_root: unknown, type: string, data: unknown) {
      if (control.failAppend) throw new Error('append failed')
      if (type === 'team/member') {
        const next = (data as { member: TeamMemberSnapshot }).member
        const index = state.members.findIndex(candidate => candidate.id === next.id)
        if (index < 0) state.members.push(next)
        else state.members[index] = next
      }
    },
  }
  const interrupt = vi.fn()
  const startContinuable = vi.fn(async (request: { id?: SessionId }) => ({
    id: request.id ?? ('other' as SessionId), provider: 'spawn', messageId: 'first' as never,
  }))
  const subagents = {
    providerName: 'spawn',
    resolve: (request: { agent: NativeAgent; session: Session; label: string; prompt: unknown }) => ({
      agent: request.agent, session: request.session, label: request.label, prompt: request.prompt,
      config: {}, maxDepth: 1, routeOverrides: {},
    }),
    startContinuable,
    interrupt,
  } as never
  const roster = new NativeTeamRoster({
    agents: { get: (id: string) => agents.get(id), list: () => [...agents.values()] } as never,
    subagents,
    persistence: (options.persistence ?? { open: async () => { throw new Error('missing') } }) as never,
    journal: journal as never,
    lifecycle: { disposed: options.disposed ?? false, signal: new AbortController().signal } as never,
    maxMembers: 2,
    maxDepth: 2,
    ownerOf: agent => owners.get(agent.id),
    rootOf: agent => roots.get(agent.id),
    statusOf: candidate => (candidate as unknown as { status: 'running' | 'idle' }).status,
  })
  return {
    roster, state, agents, owners, roots, control, startContinuable, interrupt, leadRoot, rootSession,
    addOwner(agent: NativeAgent, page: Session, status: 'running' | 'idle' = 'idle') {
      const created = owner(agent, page, status)
      owners.set(agent.id, created)
      return created
    },
    addWorker(page: Session = session('worker', rootSession.id)) {
      agents.set(workerAgent.id, workerAgent)
      roots.set(workerAgent.id, { id: page.id, agent: workerAgent, session: page })
      return page
    },
  }
}

const request = {
  name: 'worker', description: 'Do work', prompt: [{ type: 'text' as const, text: 'go' }],
  context: 'fresh' as const, provider: 'spawn', signal,
}

it('resolves teammate, foreign child, implicit root, and stale memberships', () => {
  const state = setup({ members: [member('worker', 'worker')] })
  state.addOwner(leadAgent, state.rootSession)
  const page = state.addWorker()
  state.addOwner(workerAgent, page)
  expect(state.roster.tryMembership(workerAgent)).toMatchObject({ role: 'teammate', name: 'worker' })
  expect(() => state.roster.membership({ id: NativeAgentId('stale') } as NativeAgent)).toThrow('not a member')

  state.state.members = []
  expect(state.roster.tryMembership(workerAgent)).toMatchObject({ role: 'lead', name: 'lead' })

  const descriptor = state.addWorker(session('worker', state.rootSession.id, [
    { type: 'subagent/descriptor', data: {
      version: 4, mode: 'continuable', provider: 'spawn', label: 'worker',
    } } as unknown as SessionEvent,
  ]))
  state.addOwner(workerAgent, descriptor)
  expect(state.roster.tryMembership(workerAgent)).toBeUndefined()

  const orphan = setup()
  orphan.agents.set(workerAgent.id, workerAgent)
  const orphanPage = orphan.addWorker(session('worker'))
  orphan.addOwner(workerAgent, orphanPage)
  orphan.roots.delete(workerAgent.id)
  expect(orphan.roster.tryMembership(workerAgent)).toBeUndefined()

  const orphanParent = setup()
  const missingParentPage = orphanParent.addWorker(session('worker', 'missing-parent' as SessionId))
  orphanParent.addOwner(workerAgent, missingParentPage)
  expect(orphanParent.roster.tryMembership(workerAgent)).toMatchObject({ role: 'lead', name: 'lead' })

  state.control.failState = true
  expect(state.roster.tryMembership(workerAgent)).toBeUndefined()
})

it('lists lead and teammate rows with runtime, recovery, and model diagnostics', () => {
  const state = setup({
    members: [
      member('active', 'active'),
      member('provisioning', 'provisioning', 'provisioning'),
      member('failed', 'failed', 'failed', 'boom'),
    ],
  })
  state.addOwner(leadAgent, state.rootSession, 'running')
  expect(state.roster.list(state.roster.membership(leadAgent))).toMatchObject([
    { role: 'lead', status: 'running', model: 'team-model' },
    { role: 'teammate', status: 'inactive', model: 'team-model' },
    { role: 'teammate', status: 'provisioning' },
    { role: 'teammate', status: 'failed', diagnostics: ['boom'] },
  ])

  const minimum = session('lead')
  minimum.requestHeader = () => undefined
  const detached = setup()
  detached.owners.clear()
  detached.roots.set(leadAgent.id, { id: minimum.id, agent: leadAgent, session: minimum })
  expect(detached.roster.list({ root: detached.leadRoot, id: TeamId('lead'), role: 'lead', name: 'lead' })).toEqual([
    { id: minimum.id, name: 'lead', role: 'lead', status: 'inactive', diagnostics: [] },
  ])
})

it('rejects disposed, unauthorized, invalid, duplicate, and over-limit creation', async () => {
  await expect(setup({ disposed: true }).roster.spawn(leadAgent, request))
    .rejects.toMatchObject({ code: 'TEAM_DISPOSED' })

  const state = setup()
  state.addOwner(leadAgent, state.rootSession)
  state.state.members = [member('worker', 'worker')]
  state.addWorker()
  state.addOwner(workerAgent, session('worker', state.rootSession.id))
  await expect(state.roster.spawn(workerAgent, request)).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
  await expect(state.roster.spawn(leadAgent, { ...request, name: 'lead' }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_MEMBER_NAME' })
  await expect(state.roster.spawn(leadAgent, { ...request, description: ' ' }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await expect(state.roster.spawn(leadAgent, { ...request, provider: '' }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await expect(state.roster.spawn(leadAgent, request)).rejects.toMatchObject({ code: 'TEAM_MEMBER_NAME_TAKEN' })

  const limited = setup()
  limited.addOwner(leadAgent, limited.rootSession)
  limited.state.members = [member('one', 'one'), member('two', 'two')]
  await expect(limited.roster.spawn(leadAgent, request)).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })
})

it('records failure edges for conflicting or failed child creation', async () => {
  const conflict = setup()
  conflict.addOwner(leadAgent, conflict.rootSession)
  conflict.startContinuable.mockResolvedValueOnce({
    id: 'other' as SessionId, provider: 'spawn', messageId: 'first' as never,
  })
  await expect(conflict.roster.spawn(leadAgent, request)).rejects.toMatchObject({ code: 'TEAM_PROVISIONING_CONFLICT' })
  expect(conflict.state.members[0]).toMatchObject({ phase: 'failed' })

  const failed = setup()
  failed.addOwner(leadAgent, failed.rootSession)
  failed.startContinuable.mockRejectedValueOnce(new Error('child failed'))
  await expect(failed.roster.spawn(leadAgent, request)).rejects.toThrow('child failed')
  expect(failed.state.members[0]).toMatchObject({ phase: 'failed' })
  expect(failed.interrupt).not.toHaveBeenCalled()

  const settled = setup()
  settled.addOwner(leadAgent, settled.rootSession)
  settled.startContinuable.mockImplementationOnce(async (input: { id?: SessionId }) => {
    settled.state.members = [{ ...member(input.id ?? 'x', 'worker'), phase: 'active' }]
    throw new Error('late failure')
  })
  await expect(settled.roster.spawn(leadAgent, request))
    .rejects.toThrow('teammate creation and durable failure recording both failed')

  const lost = setup()
  lost.addOwner(leadAgent, lost.rootSession)
  lost.startContinuable.mockImplementationOnce(async () => {
    lost.state.members = []
    return { id: lost.state.members.at(-1)?.id ?? ('x' as SessionId), provider: 'spawn', messageId: 'first' as never }
  })
  await expect(lost.roster.spawn(leadAgent, request)).rejects.toThrow()
})

it('reconciles provisioning members from their durable child Sessions', async () => {
  const provisioning = [member('worker', 'worker', 'provisioning')]
  const persisted = {
    open: async (id: SessionId) => ({
      header: header(String(id), SessionId('lead')),
      inheritedEventCount: 0,
      read: async () => ({ events: [
        { type: 'subagent/descriptor', data: {
          version: 4, mode: 'continuable', provider: 'spawn', label: 'worker',
        } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
      ] as unknown as SessionEvent[] }),
      close: async () => {},
    }),
  }
  const recovered = setup({ members: provisioning.map(row => ({ ...row })), persistence: persisted })
  recovered.addOwner(leadAgent, recovered.rootSession)
  await recovered.roster.recoverFor(leadAgent, signal)
  expect(recovered.state.members[0]).toMatchObject({ phase: 'active' })

  const live = setup({ members: provisioning.map(row => ({ ...row })) })
  live.addOwner(leadAgent, live.rootSession)
  live.addWorker(session('worker', live.rootSession.id))
  await live.roster.recoverFor(leadAgent, signal)
  expect(live.state.members[0]).toMatchObject({ phase: 'provisioning' })

  const mismatch = setup({
    members: provisioning.map(row => ({ ...row })),
    persistence: { open: async () => ({
      header: header('worker', SessionId('other')),
      inheritedEventCount: 0,
      read: async () => ({ events: [] }),
      close: async () => {},
    }) },
  })
  mismatch.addOwner(leadAgent, mismatch.rootSession)
  await mismatch.roster.recoverFor(leadAgent, signal)
  expect(mismatch.state.members[0]).toMatchObject({
    phase: 'failed', error: 'persisted child Session does not match the provisioned continuation',
  })

  const unreadable = setup({ members: provisioning.map(row => ({ ...row })) })
  unreadable.addOwner(leadAgent, unreadable.rootSession)
  await unreadable.roster.recoverFor(leadAgent, signal)
  expect(unreadable.state.members[0]).toMatchObject({ phase: 'failed' })
  expect(unreadable.state.members[0]?.error).toContain('recovery failed')

  await expect(unreadable.roster.recoverFor(workerAgent, new AbortController().signal))
    .resolves.toBeUndefined()
  const aborted = new AbortController()
  aborted.abort(new Error('stop'))
  await expect(unreadable.roster.recoverFor(leadAgent, aborted.signal)).rejects.toThrow('stop')
})

it('interrupts active teammates and groups live children for teardown', () => {
  const state = setup({ members: [member('worker', 'worker')] })
  state.addOwner(leadAgent, state.rootSession)
  state.addWorker()
  const workerAgentInstance = workerAgent
  state.addOwner(workerAgentInstance, session('worker', state.rootSession.id), 'running')
  expect(state.roster.interrupt(leadAgent, 'worker')).toEqual({ previousStatus: 'running' })
  expect(() => state.roster.interrupt(leadAgent, 'lead')).toThrow('cannot interrupt itself')
  expect(() => state.roster.interrupt(leadAgent, 'missing')).toThrow('not found')

  state.owners.delete(workerAgentInstance.id)
  expect(state.roster.interrupt(leadAgent, 'worker')).toEqual({ previousStatus: 'inactive' })
  expect(state.roster.liveChildrenByRoot().size).toBe(0)

  state.addOwner(workerAgentInstance, session('worker', state.rootSession.id))
  expect(state.roster.liveChildrenByRoot().get(state.leadRoot)).toEqual([SessionId('worker')])

  const orphan = setup({ members: [member('worker', 'worker')] })
  orphan.addOwner(leadAgent, orphan.rootSession)
  orphan.addWorker()
  const orphanAgent = owner(workerAgent, session('worker', orphan.rootSession.id))
  orphan.owners.set(workerAgent.id, orphanAgent)
  let rootCalls = 0
  ;(orphan.roster as unknown as { deps: { rootOf: (agent: NativeAgent) => unknown } }).deps.rootOf = (agent) => {
    if (agent.id === leadAgent.id) return rootCalls++ === 0 ? orphan.leadRoot : undefined
    return orphan.roots.get(agent.id)
  }
  expect(() => orphan.roster.interrupt(leadAgent, 'worker')).toThrow('no longer active')

  return (async () => {
    await state.roster.stopTeammates(state.leadRoot, [SessionId('worker'), SessionId('gone')])
    expect(state.interrupt).toHaveBeenCalledTimes(2)
  })()
})

it('rejects creation when the admitted signal is already aborted', async () => {
  const state = setup()
  state.addOwner(leadAgent, state.rootSession)
  const aborted = new AbortController()
  aborted.abort(new Error('stop'))
  await expect(state.roster.spawn(leadAgent, { ...request, signal: aborted.signal })).rejects.toThrow('stop')
})

it('publishes an active row for fresh and fork creations', async () => {
  for (const context of ['fresh', 'fork'] as const) {
    const state = setup()
    state.addOwner(leadAgent, state.rootSession)
    state.startContinuable.mockImplementationOnce(async (input: { id?: SessionId }) => {
      const id = input.id ?? SessionId('child')
      const childAgent = { id: NativeAgentId(String(id)) } as NativeAgent
      state.agents.set(childAgent.id, childAgent)
      state.owners.set(childAgent.id, owner(childAgent, session(String(id), state.rootSession.id)))
      return { id, provider: 'spawn', messageId: 'first' as never }
    })
    const created = await state.roster.spawn(leadAgent, { ...request, context })
    expect(created.member).toMatchObject({ role: 'teammate', status: 'idle', model: 'team-model', context })
    expect(state.state.members[0]).toMatchObject({ phase: 'active' })
    const subagents = (state.roster as unknown as { deps: { subagents: { resolve: (input: unknown) => unknown } } }).deps.subagents
    const resolved = subagents.resolve({
      agent: leadAgent, session: state.rootSession, label: 'l', prompt: [],
      options: { maxDepth: 2, ...context === 'fork' ? { inheritCompletedTurns: true } : {} },
    })
    expect(resolved).toBeDefined()
  }
})

it('rejects creation settled as failed or whose cleanup fails', async () => {
  const conflicted = setup()
  conflicted.addOwner(leadAgent, conflicted.rootSession)
  conflicted.startContinuable.mockImplementationOnce(async (input: { id?: SessionId }) => {
    const id = input.id ?? SessionId('child')
    const childAgent = { id: NativeAgentId(String(id)) } as NativeAgent
    conflicted.agents.set(childAgent.id, childAgent)
    conflicted.state.members[0] = { ...conflicted.state.members[0]!, phase: 'failed' }
    return { id, provider: 'spawn', messageId: 'first' as never }
  })
  await expect(conflicted.roster.spawn(leadAgent, request)).rejects.toThrow('reconciled as failed')

  const cleanup = setup()
  cleanup.addOwner(leadAgent, cleanup.rootSession)
  cleanup.interrupt.mockImplementation(() => { throw new Error('cleanup failed') })
  cleanup.startContinuable.mockImplementationOnce(async (input: { id?: SessionId }) => {
    const id = input.id ?? SessionId('child')
    const childAgent = { id: NativeAgentId(String(id)) } as NativeAgent
    cleanup.agents.set(childAgent.id, childAgent)
    cleanup.state.members[0] = { ...cleanup.state.members[0]!, phase: 'failed' }
    return { id, provider: 'spawn', messageId: 'first' as never }
  })
  await expect(cleanup.roster.spawn(leadAgent, request)).rejects.toThrow('provisioning conflict cleanup failed')
})

it('skips recovery rows settled during the read and stops when cancelled after loading', async () => {
  const settled = setup({
    members: [member('worker', 'worker', 'provisioning')],
    persistence: { open: async () => ({
      header: header('worker', SessionId('lead')),
      inheritedEventCount: 0,
      read: async () => {
        settled.state.members[0] = { ...settled.state.members[0]!, phase: 'active' }
        return { events: [] }
      },
      close: async () => {},
    }) },
  })
  settled.addOwner(leadAgent, settled.rootSession)
  await settled.roster.recoverFor(leadAgent, signal)
  expect(settled.state.members[0]).toMatchObject({ phase: 'active' })

  const controller = new AbortController()
  const cancelled = setup({
    members: [member('worker', 'worker', 'provisioning')],
    persistence: { open: async () => ({
      header: header('worker', SessionId('lead')),
      inheritedEventCount: 0,
      read: async () => { controller.abort(new Error('stop')); return { events: [] } },
      close: async () => {},
    }) },
  })
  cancelled.addOwner(leadAgent, cancelled.rootSession)
  await expect(cancelled.roster.recoverFor(leadAgent, controller.signal)).rejects.toThrow('stop')
})

it('resolves child-first teardown and unresolved implicit roots', () => {
  const state = setup()
  state.addOwner(leadAgent, state.rootSession)
  const descriptorPage = state.addWorker(session('worker', state.rootSession.id, [
    { type: 'subagent/descriptor', data: {
      version: 4, mode: 'continuable', provider: 'spawn', label: 'worker',
    } } as unknown as SessionEvent,
  ]))
  state.addOwner(workerAgent, descriptorPage)
  expect(state.roster.tryMembership(workerAgent)).toBeUndefined()

  const unresolved = state.addWorker(session('worker', 'missing-parent' as SessionId))
  state.addOwner(workerAgent, unresolved)
  state.roots.delete(workerAgent.id)
  expect(state.roster.tryMembership(workerAgent)).toBeUndefined()
})

it('lists teammate models and interruption without a live target', () => {
  const state = setup({ members: [member('worker', 'worker')] })
  state.addOwner(leadAgent, state.rootSession)
  const page = state.addWorker()
  state.addOwner(workerAgent, page, 'running')
  const headerless = page
  headerless.requestHeader = () => undefined
  expect(state.roster.list(state.roster.membership(leadAgent))[1]).toMatchObject({ status: 'running' })

  state.agents.delete(workerAgent.id)
  expect(state.roster.interrupt(leadAgent, 'worker')).toEqual({ previousStatus: 'inactive' })

  const teammate = setup({ members: [member('worker', 'worker')] })
  teammate.addOwner(leadAgent, teammate.rootSession)
  teammate.addWorker()
  teammate.addOwner(workerAgent, session('worker', teammate.rootSession.id))
  const workerMembership = teammate.roster.membership(workerAgent)
  expect(() => teammate.roster.interrupt(workerAgent, 'lead')).toThrow('only the Team Lead')
  expect(workerMembership.role).toBe('teammate')
})

it('groups direct children that resolve outside the durable roster as non-teammates', () => {
  const state = setup()
  state.addOwner(leadAgent, state.rootSession)
  const page = state.addWorker(session('worker', state.rootSession.id))
  state.addOwner(workerAgent, page)
  expect(state.roster.liveChildrenByRoot().size).toBe(0)
})

it('returns creation rows before the child owner is published', async () => {
  const state = setup()
  state.addOwner(leadAgent, state.rootSession)
  const gate = Promise.withResolvers<undefined>()
  state.startContinuable.mockImplementationOnce(async (input: { id?: SessionId }) => {
    await gate.promise
    return { id: input.id ?? SessionId('child'), provider: 'spawn', messageId: 'first' as never }
  })
  const creation = state.roster.spawn(leadAgent, request)
  expect(state.roster.pendingCreations()).toHaveLength(1)
  gate.resolve(undefined)
  const created = await creation
  expect(created.member).toMatchObject({ status: 'provisioning' })
  expect(state.roster.pendingCreations()).toEqual([])
})

it('treats a parentless descriptor child as a provider-owned worker', () => {
  const state = setup()
  const page = state.addWorker(session('worker', undefined, [
    { type: 'subagent/descriptor', data: {
      version: 4, mode: 'continuable', provider: 'spawn', label: 'worker',
    } } as unknown as SessionEvent,
  ]))
  state.addOwner(workerAgent, page)
  expect(state.roster.tryMembership(workerAgent)).toBeUndefined()
})

it('omits the model when neither the member nor the Lead records one', () => {
  const state = setup({ members: [member('worker', 'worker')] })
  const bare = session('lead')
  bare.requestHeader = () => undefined
  state.roots.set(leadAgent.id, { id: bare.id, agent: leadAgent, session: bare })
  state.addOwner(leadAgent, bare)
  expect(state.roster.list(state.roster.membership(leadAgent))[0]).toEqual({
    id: bare.id, name: 'lead', role: 'lead', status: 'idle', diagnostics: [],
  })
  expect(state.roster.list(state.roster.membership(leadAgent))[1]).not.toHaveProperty('model')
})

it('returns undefined for a direct child whose own root is unavailable', () => {
  const page = session('worker', SessionId('missing-parent'))
  const rootOf = vi.fn(() => undefined)
  const roster = new NativeTeamRoster({
    agents: { get: (id: string) => id === workerAgent.id ? workerAgent : undefined, list: () => [workerAgent] } as never,
    subagents: {} as never,
    persistence: {} as never,
    journal: { state: () => ({ members: [] }) } as never,
    lifecycle: {} as never,
    maxMembers: 1,
    maxDepth: 1,
    ownerOf: () => owner(workerAgent, page),
    rootOf,
    statusOf: () => 'idle',
  })
  expect(roster.tryMembership(workerAgent)).toBeUndefined()
  expect(rootOf).toHaveBeenCalled()

  const leadPage = session('lead')
  const leadRoot = { id: leadPage.id, agent: leadAgent, session: leadPage }
  const childRootOf = vi.fn((agent: NativeAgent) => agent.id === leadAgent.id ? leadRoot : undefined)
  const withParent = new NativeTeamRoster({
    agents: {
      get: (id: string) => id === workerAgent.id ? workerAgent : id === leadAgent.id ? leadAgent : undefined,
      list: () => [workerAgent],
    } as never,
    subagents: {} as never,
    persistence: {} as never,
    journal: { state: () => ({ members: [] }) } as never,
    lifecycle: {} as never,
    maxMembers: 1,
    maxDepth: 1,
    ownerOf: () => owner(workerAgent, session('worker', leadPage.id)),
    rootOf: childRootOf,
    statusOf: () => 'idle',
  })
  expect(withParent.tryMembership(workerAgent)).toBeUndefined()
  expect(childRootOf).toHaveBeenCalledWith(leadAgent)
  expect(childRootOf).toHaveBeenCalledWith(workerAgent)
})
