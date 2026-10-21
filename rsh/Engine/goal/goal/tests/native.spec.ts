/** Native Goal CAS and activation use actual JSONL durability and exact active-owner routing. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeActiveSessionRegistry, type NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { NativeGoalRegistry, resolveNativeGoalConfig } from '../src/native.ts'

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
  const goals = new NativeGoalRegistry(agents, active, resolveNativeGoalConfig({ defaultMaxGoalRounds: 2 }))
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
    retainBackground() { leases++; let released = false; return () => { if (!released) { released = true; leases-- } } },
    onEvent(observer) { observers.add(observer); return () => { observers.delete(observer) } },
    onIdle() { return async () => {} }, beforeStep() { return async () => {} },
  }
  let release: (() => Promise<void>) | undefined
  return { owner, writer, session, agent, goals, active, root, storage, get leases() { return leases },
    async attach() { release = await active.register(owner) }, async detach() { await release?.(); release = undefined },
    async close() { await goals.dispose(); await active.dispose(); await agents.dispose(); await writer.close(); await storage.close()
      await rm(root, { recursive: true }) },
  }
}

it('persists CAS transitions and keeps arming only in exact process-local residency leases', async () => {
  const state = await fixture()
  try {
    await state.attach()
    const created = await state.goals.create(state.agent, { objective: '  Finish the change.  ' })
    expect(created).toMatchObject({ objective: 'Finish the change.', phase: 'active', activation: 'armed', maxGoalRounds: 2 })
    expect(state.leases).toBe(1)
    const paused = await state.goals.pause(state.agent, created)
    expect(paused.activation).toBe('disarmed')
    expect(state.leases).toBe(0)
    await expect(state.goals.resume(state.agent, created)).rejects.toMatchObject({ code: 'GOAL_STALE_REVISION' })
    const resumed = await state.goals.resume(state.agent, paused)
    expect(state.leases).toBe(1)
    const completed = await state.goals.complete(state.agent, resumed)
    expect(completed.phase).toBe('complete')
    expect(state.leases).toBe(0)
    const cleared = await state.goals.clear(state.agent, completed)
    expect(cleared.revision).toBe(completed.revision + 1)
    expect(state.goals.get(state.agent)).toBeUndefined()
    const events = (await state.writer.read()).events.filter(event => event.type === 'goal/change')
    expect(events).toHaveLength(5)
    expect(JSON.stringify(events)).not.toContain('activation')
    expect(() => state.goals.get({ ...state.agent })).toThrow('not live')
  } finally { await state.close() }
})

it('serializes concurrent CAS writes and restores a durable active Goal without automatic authority', async () => {
  const state = await fixture()
  try {
    await state.attach()
    const goal = await state.goals.create(state.agent, { objective: 'Continue in this Session.' })
    const results = await Promise.allSettled([
      state.goals.edit(state.agent, goal, { objective: 'First revision.' }),
      state.goals.edit(state.agent, goal, { objective: 'Competing revision.' }),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(state.leases).toBe(1)
    await state.detach()
    await state.attach()
    expect(state.goals.get(state.agent)).toMatchObject({ objective: 'First revision.', phase: 'active', activation: 'disarmed' })
    expect(state.leases).toBe(0)
    const current = state.goals.get(state.agent)!
    const resumed = await state.goals.resume(state.agent, current)
    expect(resumed.activation).toBe('armed')
    await state.goals.dispose()
    expect(state.leases).toBe(0)
  } finally { await state.close() }
})

it('buffers durable events during initial history read and applies each sequence once', async () => {
  const state = await fixture()
  const read = state.owner.readEvents.bind(state.owner)
  const captured = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  state.owner.readEvents = async () => { const events = await read(); captured.resolve(undefined); await resume.promise; return events }
  try {
    const attaching = state.attach()
    await captured.promise
    state.owner.append('goal/change', { kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: 'goal-race' as import('../src/types.ts').GoalId, revision: 1, objective: 'Captured race.', phase: 'active', maxGoalRounds: 2 },
      roundsStarted: 0, createdAt: 1, updatedAt: 1 })
    await state.owner.flush()
    resume.resolve(undefined)
    await attaching
    expect(state.goals.get(state.agent)).toMatchObject({ objective: 'Captured race.', roundsStarted: 0, activation: 'disarmed' })
    expect(state.leases).toBe(0)
  } finally { await state.close() }
})

it('checks observed absence inside the serialized create admission rather than replacing a competing Goal', async () => {
  const state = await fixture()
  const flush = state.owner.flush.bind(state.owner)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let held = false
  try {
    await state.attach()
    state.owner.flush = async () => {
      if (!held) { held = true; entered.resolve(undefined); await release.promise }
      await flush()
    }
    const results = Promise.allSettled([
      state.goals.create(state.agent, { objective: 'First accepted Goal.', expectedRef: null }),
      state.goals.create(state.agent, { objective: 'Stale empty observation.', expectedRef: null }),
    ])
    await entered.promise
    release.resolve(undefined)
    const settled = await results
    expect(settled[0]?.status).toBe('fulfilled')
    expect(settled[1]).toMatchObject({ status: 'rejected', reason: { code: 'GOAL_STALE_REVISION' } })
    expect(state.goals.get(state.agent)?.objective).toBe('First accepted Goal.')
    expect((await state.writer.read()).events.filter(event => event.type === 'goal/change')).toHaveLength(1)
  } finally { release.resolve(undefined); await state.close() }
})
