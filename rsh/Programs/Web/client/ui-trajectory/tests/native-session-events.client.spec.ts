import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { buildTrajectorySnapshot } from '../src/trajectory-session-events.ts'
import { deriveTrajectoryLayout } from '../src/client/layout.ts'
import { t } from './locale.client.ts'

function event(seq: number, time: number, type: string, data: unknown): SessionEvent {
  return { seq: SessionSeq(seq), time, type, data, surfaceOp: 'append' } as unknown as SessionEvent
}

function assistant(seq: number, time: number, turn: number, step: number) {
  return event(seq, time, 'assistant/message', {
    turn,
    step,
    message: {
      id: `assistant-${turn}`,
      role: 'assistant',
      source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text: `turn ${turn}` }],
    },
    stream: [],
  })
}

describe('Native Trajectory Session projection', () => {
  it('uses each persisted step start for assistant duration', () => {
    const snapshot = buildTrajectorySnapshot([
      event(0, 1_000, 'turn/start', { turn: 1 }),
      event(1, 1_000, 'step/start', { turn: 1, step: 1 }),
      assistant(2, 1_050, 1, 1),
      event(3, 1_060, 'step/end', { turn: 1, step: 1 }),
      event(4, 1_060, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(5, 1_070, 'turn/start', { turn: 2 }),
      event(6, 1_070, 'step/start', { turn: 2, step: 1 }),
      assistant(7, 1_200, 2, 1),
    ])
    const turns = deriveTrajectoryLayout({
      nodes: snapshot.eventNodes,
      systemPrompts: snapshot.systemPrompts,
      eventLocations: snapshot.eventLocations,
      partial: snapshot.partial,
      runningCalls: snapshot.runningCalls,
      requests: snapshot.requests,
      callSchemas: snapshot.callSchemas,
    }, t)
    const secondAssistant = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
      .find(cell => cell.sourceSeq === 7)

    expect(snapshot.eventNodes.find(node => node.kind === 'assistant' && node.turn === 2)).toMatchObject({
      timing: { stepStartTime: 1_070, completedTime: 1_200 },
    })
    expect(secondAssistant?.timeSeconds).toBe(0.13)
  })

  it('keeps a failed attempt turn visible before the next successful turn', () => {
    const snapshot = buildTrajectorySnapshot([
      event(0, 1_000, 'turn/start', { turn: 1 }),
      event(1, 1_010, 'step/start', { turn: 1, step: 1 }),
      event(2, 1_090, 'assistant/attempt', { turn: 1, step: 1, stream: [] }),
      event(3, 1_095, 'step/end', { turn: 1, step: 1 }),
      event(4, 1_100, 'turn/end', {
        turn: 1, reason: { kind: 'error', error: { code: 'PROVIDER', message: 'provider failed' } },
      }),
      event(5, 1_200, 'turn/start', { turn: 2 }),
      event(6, 1_210, 'step/start', { turn: 2, step: 1 }),
      assistant(7, 1_220, 2, 1),
    ])
    const turns = deriveTrajectoryLayout({
      nodes: snapshot.eventNodes,
      systemPrompts: snapshot.systemPrompts,
      eventLocations: snapshot.eventLocations,
      partial: snapshot.partial,
      runningCalls: snapshot.runningCalls,
      requests: snapshot.requests,
      callSchemas: snapshot.callSchemas,
    }, t)

    expect(snapshot.requests).toMatchObject([
      { turn: 1, step: 1, status: 'error', error: 'provider failed', errorCode: 'PROVIDER' },
      { turn: 2, step: 1, status: 'complete' },
    ])
    expect(snapshot.eventLocations.get(SessionSeq(0))).toMatchObject({ kind: 'turn', turn: { turn: 1 } })
    expect(snapshot.eventLocations.get(SessionSeq(2))).toMatchObject({ kind: 'step', turn: { turn: 1 }, step: { step: 1 } })
    expect(turns.map(turn => turn.turn)).toEqual([1, 2])
  })
})
