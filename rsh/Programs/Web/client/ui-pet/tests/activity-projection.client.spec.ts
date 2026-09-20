import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationNodeDefinition, ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { createPetActivityBuilder, registerPetProjection, type PetLifecycle } from '../src/client/activity-projection.ts'

function harness() {
  const events: Array<ConversationNodeDefinition<PetLifecycle>> = []
  const views: ConversationViewDefinition[] = []
  registerPetProjection({ uiConversation: {
    events: { register: (definition: ConversationNodeDefinition) => {
      events.push(definition as ConversationNodeDefinition<PetLifecycle>)
    } },
    views: { register: (definition: ConversationViewDefinition) => { views.push(definition) } },
  } } as unknown as Context, { codingTools: ['edit'], planningTools: ['todo_write'] })
  const assembler = new ConversationNodeAssembler({ entries: () => events, fallbackEntry: () => undefined }, { entries: () => views })
  assembler.activateTarget('pet-activity')
  return {
    assembler,
    events,
    views,
    state: () => { assembler.flush(); return assembler.snapshot('pet-activity') as PetLifecycle | undefined },
  }
}

function event(seq: number, type: string, data: unknown) {
  return { type: 'event' as const, event: { seq, type, data, time: 1000 + seq } as SessionEvent }
}

describe('pet activity Conversation projection', () => {
  it('tracks coding, planning, generic tools, rate limiting, and retry recovery', () => {
    const { assembler, state } = harness()
    assembler.replaceWindow([event(1, 'turn/start', { turn: 1 })], false)
    expect(state()?.activity).toBe('thinking')
    assembler.append(event(2, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'edit', arguments: '{}' }))
    expect(state()?.activity).toBe('coding')
    assembler.append(event(3, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'todo_write', arguments: '{}' }))
    expect(state()?.activity).toBe('planning')
    assembler.append(event(4, 'tool/result', { turn: 1, step: 1, message: { source: { callId: 'b' }, content: [] } }))
    expect(state()?.activity).toBe('coding')
    assembler.append(event(5, 'tool/call', { turn: 1, step: 1, callId: 'c', name: 'bash', arguments: '{}' }))
    expect(state()?.activity).toBe('working')
    assembler.append(event(6, 'llm/retry', { turn: 1, step: 1, failure: { code: 'RATE_LIMIT' } }))
    expect(state()?.activity).toBe('sleeping')
    assembler.append(event(7, 'llm/retry-started', { turn: 1, step: 1 }))
    expect(state()?.activity).toBe('thinking')
    assembler.append(event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(state()?.active).toBe(false)
  })

  it('restores the running turn after a separately identified compaction finishes', () => {
    const { assembler, state } = harness()
    assembler.replaceWindow([event(1, 'turn/start', { turn: 1 })], false)
    assembler.append(event(2, 'compaction/start', { turn: 1, compactionId: 'compact-a' }))
    expect(state()?.activity).toBe('compacting')
    assembler.append(event(3, 'compaction/end', { turn: 1, compactionId: 'compact-a' }))
    expect(state()?.activity).toBe('thinking')
  })

  it('reconstructs an update-only tail when pagination supplies its turn start', () => {
    const full = harness()
    const paged = harness()
    const start = event(1, 'turn/start', { turn: 1 })
    const call = event(2, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'edit', arguments: '{}' })
    full.assembler.replaceWindow([start, call], false)
    paged.assembler.replaceWindow([call], true)
    expect(paged.state()).toBeUndefined()
    paged.assembler.prepend([start], false)
    expect(paged.state()).toEqual(full.state())
  })

  it('rejects unrelated events and retains newer lifecycle records in its bounded view', () => {
    const { events, views } = harness()
    const [turn, compaction] = events
    if (turn === undefined || compaction === undefined || views[0] === undefined) throw new Error('Expected pet projection registrations')
    const unrelated = event(1, 'message/user', {})
    expect(turn.match(unrelated.event)).toBeNull()
    expect(compaction.match(unrelated.event)).toBeNull()

    const started = turn.start({} as never, { event: event(2, 'turn/start', { turn: 1 }).event } as never, {} as never)
    expect(started.activity).toBe('thinking')
    expect(turn.update({ state: started } as never, { event: unrelated.event } as never)).toBe(started)
    expect(turn.buildViewNode?.({ state: undefined } as never)).toBeNull()
    expect(turn.buildViewNode?.({ key: 'pet:1', id: '1', state: started } as never)).toMatchObject({ kind: 'turn', data: started })

    expect(compaction.match(event(3, 'compaction/start', { turn: 1, compactionId: 'compact' }).event)).toMatchObject({ role: 'start' })
    expect(compaction.match(event(4, 'compaction/end', { turn: 1, compactionId: 'compact' }).event)).toMatchObject({ role: 'update' })
    expect(compaction.buildViewNode?.({ state: undefined } as never)).toBeNull()
    expect(views[0].isActive?.(undefined)).toBe(false)

    const complete = turn.update({ state: started } as never, {
      event: event(5, 'turn/end', { turn: 1, reason: { kind: 'error' } }).event,
    } as never)
    expect(complete).toMatchObject({ active: false, activity: 'error' })
    const emptied = turn.update({ state: started } as never, {
      event: event(6, 'tool/result', { turn: 1, step: 1, message: { source: { callId: 'missing' }, content: [] } }).event,
    } as never)
    expect(emptied).toMatchObject({ activity: 'thinking' })
    const retried = turn.update({ state: started } as never, {
      event: event(7, 'llm/retry', { turn: 1, step: 1, failure: { code: 'TIMEOUT' } }).event,
    } as never)
    expect(retried).toMatchObject({ activity: 'thinking' })

    const builder = createPetActivityBuilder()
    expect(builder.replace({ nodes: [] } as never)).toBeUndefined()
    const current = { seq: 3, startedAt: 3, active: true, activity: 'coding' as const }
    expect(builder.apply({ upserts: [{ kind: 'turn', data: current }] } as never)).toEqual(current)
    expect(builder.apply({ upserts: [{ kind: 'turn', data: { ...current, seq: 2 } }] } as never)).toEqual(current)
    expect(builder.apply({ upserts: [{ kind: 'compaction', data: { ...current, active: false } }] } as never)).toEqual(current)
  })
})
