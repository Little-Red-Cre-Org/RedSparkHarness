/** Native Agent Teams over real JSONL durability and exact active-owner routing. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import { NativeAgentId, NativeAgentRegistry } from '@redspark/rsh-native-agent'
import { NativeScope } from '@redspark/rsh-native-runtime'
import { NativeActiveSessionRegistry, type NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { NativeSubagentOperations, NativeSubagentRequest } from '@redspark/rsh-native-subagent'
import { MessageId, type ContentBlock } from '@redspark/rsh-llm/native'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl/native'
import { NativeSessionProjectionRegistry } from '@redspark/rsh-session-projection/native'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader } from '@redspark/rsh-session/native'
import { plugin, resolveNativeTeamConfig, NativeTeamService, TeamTaskId, TeamError } from '../src/native.ts'
import { teamProjectionDefinition } from '../src/projection.ts'

const signal = new AbortController().signal

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-team-'))
  const storage = new JsonlSessionBackend({ root, compression: 'none' })
  const agents = new NativeAgentRegistry({ emit() {} })
  const active = new NativeActiveSessionRegistry(agents)
  const projections = new NativeSessionProjectionRegistry()
  projections.register(teamProjectionDefinition)
  const owners: NativeActiveSessionOwner[] = []
  const releases: Array<() => Promise<void>> = []

  function ownerFor(agent: NativeAgent, session: Session, writer: Awaited<ReturnType<typeof storage.create>>): NativeActiveSessionOwner {
    const pending: SessionEvent[] = []
    const observers = new Set<(event: SessionEvent) => void>()
    const owner: NativeActiveSessionOwner = {
      agent, session, invocation: 'root', inheritedEventCount: 0, writerAvailable: true,
      append(type, data, ...options) {
        const event = session.append(type, data, ...options)
        pending.push(event as SessionEvent)
        return event
      },
      appendBatch(inputs) {
        const events = session.appendBatch(inputs)
        pending.push(...events)
        return events
      },
      async flush() {
        const events = pending.splice(0)
        if (events.length > 0) await writer.append(events)
        await writer.flush()
        for (const event of events) for (const observer of observers) observer(event)
      },
      async readEvents() {
        await owner.flush()
        return (await writer.read()).events
      },
      async readCommittedEvents(maxEvents) {
        await owner.flush()
        return (await writer.read(0, maxEvents ?? Number.MAX_SAFE_INTEGER)).events
      },
      messages() { return [] },
      async enqueue(message, target) {
        owner.append('agent/inbox/spliced', { target, start: 0, inserted: [message] })
        await owner.flush()
        return message.id
      },
      async remove() {},
      async editPendingText() { throw new Error('Native Team fixture does not exercise pending text edits') },
      async promotePending() { throw new Error('Native Team fixture does not exercise pending promotion') },
      retain() { return () => {} },
      retainBackground() { return () => {} },
      onEvent(observer) {
        observers.add(observer)
        return () => { observers.delete(observer) }
      },
      onIdle() { return async () => {} },
      beforeStep() { return async () => {} },
    }
    return owner
  }

  async function createSession(id: SessionId, parentSession?: SessionId): Promise<{
    agent: NativeAgent
    session: Session
    owner: NativeActiveSessionOwner
  }> {
    const header: SessionHeader = {
      id,
      version: SESSION_FORMAT_VERSION,
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
      cwd: root,
      ...parentSession === undefined ? {} : { parentSession },
    }
    const writer = await storage.create(header)
    const session = Session.create(id, undefined, header)
    const agent: NativeAgent = { id: NativeAgentId(id), scope: new NativeScope() }
    agents.register(agent)
    const owner = ownerFor(agent, session, writer)
    projections.attach(owner)
    releases.push(await active.register(owner))
    owners.push(owner)
    return { agent, session, owner }
  }

  const lead = await createSession(SessionId('team-lead'))

  const subagents = {
    providerName: 'spawn',
    backgroundJobs: undefined,
    continuationTools: undefined,
    onFinished: () => () => {},
    onExternalStarted: () => () => {},
    onExternalFinished: () => () => {},
    resolve(request: {
      agent: NativeAgent
      session: Session
      label: string
      prompt: readonly ContentBlock[]
    }): NativeSubagentRequest {
      return {
        agent: request.agent,
        session: request.session,
        label: request.label,
        prompt: request.prompt,
        config: {} as never,
        maxDepth: 1,
        routeOverrides: {},
      }
    },
    async startContinuable(request: NativeSubagentRequest) {
      const id = request.id ?? SessionId(randomUUID())
      await createSession(id, request.session.id)
      return { id, provider: 'spawn', messageId: MessageId(`first-${id}`) }
    },
    async sendMessage() { return MessageId('cold-message') },
    interrupt: vi.fn(),
    async list() { return [] },
    async run() { throw new Error('not used') },
    async start() { throw new Error('not used') },
    async startBackground() { throw new Error('not used') },
  } satisfies NativeSubagentOperations

  const service = new NativeTeamService({
    agents, active, projections, persistence: storage, subagents,
  }, resolveNativeTeamConfig({ maxMembers: 3, maxTasks: 8, maxPendingMessagesPerMember: 2, maxMessageBytes: 8_192 }))
  active.onAttached((owner) => {
    service.attach(owner)
    return Promise.resolve()
  })
  service.attach(lead.owner)
  return {
    root, storage, agents, active, projections, service, lead, subagents, createSession, owners, releases,
    async findMember(name: string) {
      const row = service.listMembers(lead.agent).find(candidate => candidate.name === name)!
      return owners.find(owner => SessionId(owner.agent.id) === row.id)!
    },
    async close() {
      await service.dispose()
      for (const release of releases.reverse()) await release()
      await active.dispose()
      await agents.dispose()
      await storage.close()
      await rm(root, { recursive: true })
    },
  }
}

function prompt(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

it('reserves a durable child identity and publishes an active teammate', async () => {
  const state = await fixture()
  try {
    const spawned = await state.service.spawnTeammate(state.lead.agent, {
      name: 'worker', description: 'Do the work', prompt: prompt('Start.'), context: 'fresh',
      provider: 'spawn', signal,
    })
    expect(spawned.member).toMatchObject({
      name: 'worker', role: 'teammate', status: 'idle', description: 'Do the work', provider: 'spawn', context: 'fresh',
    })
    const worker = await state.findMember('worker')
    expect(state.service.membership(worker.agent)).toMatchObject({ role: 'teammate', name: 'worker', id: 'team-lead' })
    expect(state.service.listMembers(state.lead.agent).map(member => member.name)).toEqual(['lead', 'worker'])
    const handle = await state.storage.open(SessionId('team-lead'), 'read')
    const events = (await handle.read()).events
    await handle.close()
    expect(events.filter(event => event.type === 'team/member').map(event => event.data.member.phase))
      .toEqual(['provisioning', 'active'])
  } finally {
    await state.close()
  }
})

it('rejects teammate creation and interruption from non-Leads', async () => {
  const state = await fixture()
  try {
    await state.service.spawnTeammate(state.lead.agent, {
      name: 'worker', description: 'Do the work', prompt: prompt('Start.'), context: 'fresh',
      provider: 'spawn', signal,
    })
    const worker = await state.findMember('worker')
    await expect(state.service.spawnTeammate(worker.agent, {
      name: 'nested', description: 'Nested', prompt: prompt('Go.'), context: 'fresh', provider: 'spawn', signal,
    })).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    expect(() => state.service.interrupt(worker.agent, 'lead')).toThrow('only the Team Lead')
    await expect(state.service.spawnTeammate(state.lead.agent, {
      name: 'worker', description: 'Duplicate', prompt: prompt('Go.'), context: 'fresh', provider: 'spawn', signal,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NAME_TAKEN' })
    await expect(state.service.spawnTeammate(state.lead.agent, {
      name: 'Bad Name', description: 'Bad', prompt: prompt('Go.'), context: 'fresh', provider: 'spawn', signal,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_MEMBER_NAME' })
  } finally {
    await state.close()
  }
})

it('delivers durable peer messages through the exact target writer', async () => {
  const state = await fixture()
  try {
    await state.service.spawnTeammate(state.lead.agent, {
      name: 'worker', description: 'Do the work', prompt: prompt('Start.'), context: 'fresh',
      provider: 'spawn', signal,
    })
    const worker = await state.findMember('worker')
    const sent = await state.service.sendMessage(state.lead.agent, {
      target: 'worker', content: prompt('Please continue.'), signal,
    })
    expect(sent.status).toBe('accepted')
    const workerHandle = await state.storage.open(worker.session.id, 'read')
    const workerEvents = (await workerHandle.read()).events
    await workerHandle.close()
    expect(workerEvents.some(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'team-message'))).toBe(true)
    const reply = await state.service.sendMessage(worker.agent, {
      target: 'lead', content: prompt('Done.'), signal,
    })
    expect(reply.status).toBe('accepted')
    await expect(state.service.sendMessage(state.lead.agent, {
      target: 'lead', content: prompt('Self.'), signal,
    })).rejects.toMatchObject({ code: 'TEAM_SELF_MESSAGE' })
    await expect(state.service.sendMessage(state.lead.agent, {
      target: 'missing', content: prompt('Missing.'), signal,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
    expect(() => state.service.interrupt(state.lead.agent, 'lead')).toThrow('cannot interrupt itself')
    expect(state.service.interrupt(state.lead.agent, 'worker')).toEqual({ previousStatus: 'idle' })
  } finally {
    await state.close()
  }
})

it('applies ordered task CAS transitions and dependency readiness', async () => {
  const state = await fixture()
  try {
    await state.service.spawnTeammate(state.lead.agent, {
      name: 'worker', description: 'Do the work', prompt: prompt('Start.'), context: 'fresh',
      provider: 'spawn', signal,
    })
    const worker = await state.findMember('worker')
    const first = await state.service.createTask(state.lead.agent, {
      subject: 'First', description: 'First task', writeScopes: ['src/a', 'src/a'],
    })
    const second = await state.service.createTask(state.lead.agent, {
      subject: 'Second', description: 'Second task', blockedBy: [first.id],
    })
    expect(second).toMatchObject({ ready: false, blockedBy: [first.id] })
    expect(state.service.getTask(state.lead.agent, second.id)).toMatchObject({ revision: 1 })
    expect(state.service.listTasks(state.lead.agent).map(task => task.subject)).toEqual(['First', 'Second'])
    await expect(state.service.updateTask(worker.agent, {
      taskId: second.id, expectedRevision: 1, action: 'claim',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_BLOCKED' })
    const claimedFirst = await state.service.updateTask(worker.agent, {
      taskId: first.id, expectedRevision: 1, action: 'claim',
    })
    expect(claimedFirst).toMatchObject({ status: 'in_progress', ownerName: 'worker', revision: 2 })
    await expect(state.service.updateTask(worker.agent, {
      taskId: first.id, expectedRevision: 1, action: 'complete',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
    await state.service.updateTask(worker.agent, { taskId: first.id, expectedRevision: 2, action: 'complete' })
    expect(state.service.getTask(state.lead.agent, second.id).ready).toBe(true)
    await state.service.updateTask(worker.agent, { taskId: second.id, expectedRevision: 1, action: 'claim' })
    await state.service.updateTask(worker.agent, { taskId: second.id, expectedRevision: 2, action: 'complete' })
    expect(() => state.service.getTask(state.lead.agent, TeamTaskId('missing'))).toThrow('not found')
    await expect(state.service.createTask(state.lead.agent, {
      subject: 'Blocked', description: 'Blocked', blockedBy: [TeamTaskId('missing')],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
  } finally {
    await state.close()
  }
})

it('wakes waiters on later Team activity and validates the timeout', async () => {
  const state = await fixture()
  try {
    await expect(state.service.waitForChange(state.lead.agent, 1, signal))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TIMEOUT' })
    const waiting = state.service.waitForChange(state.lead.agent, 10_000, signal)
    await state.service.createTask(state.lead.agent, { subject: 'Wake', description: 'Wake the waiter' })
    await expect(waiting).resolves.toEqual({ timedOut: false })
  } finally {
    await state.close()
  }
})

it('enforces resolved deployment limits and disposes the runtime', async () => {
  expect(() => resolveNativeTeamConfig({ unknown: 1 })).toThrow(TeamError)
  expect(() => resolveNativeTeamConfig({ maxMembers: 0 })).toThrow('positive safe integer')
  const defaults = {
    maxMembers: 8, maxTasks: 256, maxPendingMessagesPerMember: 64, maxMessageBytes: 65_536,
    disposalTimeoutMs: 5_000, maxDepth: 3,
  }
  expect(resolveNativeTeamConfig({})).toMatchObject(defaults)
  expect(resolveNativeTeamConfig()).toMatchObject(defaults)
  const state = await fixture()
  try {
    await state.service.dispose()
    await expect(state.service.spawnTeammate(state.lead.agent, {
      name: 'late', description: 'Late', prompt: prompt('Late.'), context: 'fresh', provider: 'spawn', signal,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
  } finally {
    await state.close()
  }
})

it('tracks exact attached owners, turn status, and recorded configuration', async () => {
  const state = await fixture()
  try {
    expect(state.service.configuration()).toMatchObject({ maxMembers: 3, maxTasks: 8, maxDepth: 3 })
    state.service.attach(state.lead.owner)
    state.lead.owner.append('turn/start', { turn: 1 })
    await state.lead.owner.flush()
    expect(state.service.listMembers(state.lead.agent)[0]).toMatchObject({ status: 'running' })
    state.lead.owner.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await state.lead.owner.flush()
    expect(state.service.listMembers(state.lead.agent)[0]).toMatchObject({ status: 'idle' })
    expect(state.service.tryMembership(state.lead.agent)).toMatchObject({ role: 'lead' })
    state.service.detach(state.lead.owner)
    expect(state.service.tryMembership(state.lead.agent)).toBeUndefined()
    const internals = state.service as unknown as { rootOf: (agent: NativeAgent) => unknown }
    expect(internals.rootOf(state.lead.agent)).toBeUndefined()
    state.service.detach(state.lead.owner)
    await state.service.dispose()
    state.service.attach(state.lead.owner)
    expect(() => state.service.listMembers(state.lead.agent)).toThrow('not a member')
  } finally {
    await state.close()
  }
})

it('reports task mutations as business results and exposes a detached view', async () => {
  const state = await fixture()
  try {
    const created = await state.service.createTaskResult(state.lead.agent, {
      subject: 'Task', description: 'Description',
    })
    expect(created).toMatchObject({ ok: true, value: { revision: 1 } })
    const rejected = await state.service.createTaskResult(state.lead.agent, {
      subject: 'Task', description: 'Description',
      blockedBy: [TeamTaskId('missing')],
    })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'team-rejected' } })
    const stale = await state.service.updateTaskResult(state.lead.agent, {
      taskId: created.ok ? created.value.id : TeamTaskId('missing'),
      expectedRevision: 9,
      action: 'claim',
    })
    expect(stale).toMatchObject({ ok: false, error: { code: 'team-task-conflict' } })
    expect(state.service.view(state.lead.agent)).toMatchObject({
      members: [{ name: 'lead' }], tasks: [{ subject: 'Task' }],
    })
    const internals = state.service as unknown as {
      createTask: () => Promise<never>
    }
    internals.createTask = async () => { throw new Error('unexpected') }
    await expect(state.service.createTaskResult(state.lead.agent, {
      subject: 'Task', description: 'Description',
    })).rejects.toThrow('unexpected')
  } finally {
    await state.close()
  }
})

it('reports disposal failures from teammate interruption', async () => {
  const state = await fixture()
  await state.service.spawnTeammate(state.lead.agent, {
    name: 'worker', description: 'Do the work', prompt: prompt('Start.'), context: 'fresh',
    provider: 'spawn', signal,
  })
  state.subagents.interrupt.mockImplementation(() => { throw new Error('interrupt failed') })
  await expect(state.service.dispose()).rejects.toThrow('Agent Teams runtime disposal failed')
  await state.active.dispose()
  await state.agents.dispose()
  await state.storage.close()
  await rm(state.root, { recursive: true })
})

it('installs the Native provider over the selected services', async () => {
  const provided: unknown[] = []
  const effects: Array<() => unknown> = []
  const owned: Array<() => unknown> = []
  const attached: Array<(owner: NativeActiveSessionOwner) => Promise<void>> = []
  const detached: Array<(owner: NativeActiveSessionOwner) => Promise<void>> = []
  const fakeOwner = {
    agent: { id: NativeAgentId('owner'), scope: {} },
    session: { id: SessionId('owner') },
    onEvent: () => () => {},
  } as unknown as NativeActiveSessionOwner
  const deps = {
    agents: new NativeAgentRegistry({ emit() {} }),
    activeSessions: {
      onAttached: (listener: (owner: NativeActiveSessionOwner) => Promise<void>) => { attached.push(listener); return () => {} },
      onDetached: (listener: (owner: NativeActiveSessionOwner) => Promise<void>) => { detached.push(listener); return () => {} },
      owners: () => [fakeOwner],
    },
    sessionProjections: { register: () => () => {} },
    sessionPersistence: {},
    subagents: {},
  }
  const context = {
    require: (key: string) => (deps as Record<string, unknown>)[key],
    effect: (disposer: () => unknown) => { effects.push(disposer); return async () => {} },
    provide: (key: string, value: unknown) => { provided.push([key, value]) },
    own: (disposer: () => unknown) => { owned.push(disposer); return async () => {} },
  }
  void plugin.resolve({ maxTasks: 4 })(context as never)
  expect(provided).toHaveLength(1)
  expect(provided[0]).toMatchObject(['agentTeams', { }])
  expect(effects).toHaveLength(3)
  expect(attached).toHaveLength(1)
  expect(detached).toHaveLength(1)
  await attached[0]?.(fakeOwner)
  await detached[0]?.(fakeOwner)
  for (const dispose of effects) await dispose()
  for (const dispose of owned) await dispose()
})

it('rejects non-object configuration values', () => {
  expect(() => resolveNativeTeamConfig(null)).toThrow('must be an object')
  expect(() => resolveNativeTeamConfig([])).toThrow('must be an object')
  expect(() => resolveNativeTeamConfig('bad')).toThrow('must be an object')
})

it('serializes concurrent transactions and reports an inactive Lead writer', async () => {
  const state = await fixture()
  try {
    const [first, second] = await Promise.all([
      state.service.createTask(state.lead.agent, { subject: 'First', description: 'First' }),
      state.service.createTask(state.lead.agent, { subject: 'Second', description: 'Second' }),
    ])
    expect([first.subject, second.subject]).toEqual(['First', 'Second'])
    await state.releases[0]?.()
    await expect(state.service.createTask(state.lead.agent, { subject: 'Late', description: 'Late' }))
      .rejects.toMatchObject({ code: 'TEAM_NOT_ACTIVE' })
  } finally {
    await state.close()
  }
})

it('contains failed and post-disposal recovery passes', async () => {
  const state = await fixture()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const internals = state.service as unknown as {
      recoverFor: () => Promise<void>
      scheduleRecovery: (agent: NativeAgent) => void
    }
    internals.recoverFor = async () => { throw new Error('recovery failed') }
    internals.scheduleRecovery(state.lead.agent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recovery for'))
    await state.service.dispose()
    internals.scheduleRecovery(state.lead.agent)
    await new Promise(resolve => setTimeout(resolve, 0))
  } finally {
    warn.mockRestore()
    await state.close()
  }
})

it('surfaces projection availability and recorded failure through the journal', async () => {
  const state = await fixture()
  try {
    const projections = state.projections as unknown as {
      stateOf: () => unknown
    }
    const original = projections.stateOf
    projections.stateOf = () => undefined
    await expect(state.service.createTask(state.lead.agent, { subject: 'A', description: 'A' }))
      .rejects.toThrow('projection is not registered')
    projections.stateOf = () => ({ failure: 'corrupt team log' })
    await expect(state.service.createTask(state.lead.agent, { subject: 'B', description: 'B' }))
      .rejects.toThrow('corrupt team log')
    projections.stateOf = original
  } finally {
    await state.close()
  }
})

it('keeps a failed peer delivery queued and warns', async () => {
  const state = await fixture()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await state.service.spawnTeammate(state.lead.agent, {
      name: 'worker', description: 'Do the work', prompt: prompt('Start.'), context: 'fresh',
      provider: 'spawn', signal,
    })
    const worker = await state.findMember('worker')
    worker.enqueue = async () => { throw new Error('enqueue failed') }
    const sent = await state.service.sendMessage(state.lead.agent, {
      target: 'worker', content: prompt('Retry later.'), signal,
    })
    expect(sent.status).toBe('queued')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('remains queued'))
  } finally {
    warn.mockRestore()
    await state.close()
  }
})

it('marks a teammate running during its turn', async () => {
  const state = await fixture()
  try {
    await state.service.spawnTeammate(state.lead.agent, {
      name: 'worker', description: 'Do the work', prompt: prompt('Start.'), context: 'fresh',
      provider: 'spawn', signal,
    })
    const worker = await state.findMember('worker')
    worker.append('turn/start', { turn: 1 })
    await worker.flush()
    expect(state.service.listMembers(state.lead.agent).find(member => member.name === 'worker'))
      .toMatchObject({ status: 'running' })
    worker.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await worker.flush()
  } finally {
    await state.close()
  }
})
