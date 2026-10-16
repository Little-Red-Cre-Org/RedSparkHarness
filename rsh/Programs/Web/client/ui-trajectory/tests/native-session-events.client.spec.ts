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

  it.each([
    {
      name: 'an assistant-message window',
      events: [
        assistant(0, 1_050, 1, 1),
        event(1, 1_060, 'step/end', { turn: 1, step: 1 }),
        event(2, 1_060, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
        event(3, 1_070, 'turn/start', { turn: 2 }),
        event(4, 1_080, 'step/start', { turn: 2, step: 1 }),
        event(5, 1_085, 'system/message', {
          turn: 2, step: 1,
          message: {
            id: 'system-2', role: 'system', source: { kind: 'plugin', plugin: 'test' },
            content: [{ type: 'text', text: 'system prompt' }],
          },
        }),
        event(6, 1_090, 'user/message', {
          id: 'user-2', role: 'user', content: [{ type: 'text', text: 'turn 2 prompt' }],
          source: { kind: 'user' },
        }),
        assistant(7, 1_100, 2, 1),
      ],
      expectedTurnOrder: [1, 2],
      expectedPlacements: [{ seq: 6, turn: 2 }],
      expectedUpdatedSystemTurns: [2],
      expectedLocations: [],
    },
    {
      name: "a failed turn's user-message window",
      events: [
        event(0, 1_000, 'user/message', {
          id: 'user-1', role: 'user', content: [{ type: 'text', text: 'failed turn prompt' }],
          source: { kind: 'user' },
        }),
        event(1, 1_010, 'assistant/attempt', { turn: 1, step: 1, stream: [] }),
        event(2, 1_020, 'step/end', { turn: 1, step: 1 }),
        event(3, 1_030, 'turn/end', {
          turn: 1, reason: { kind: 'error', error: { code: 'PROVIDER', message: 'provider failed' } },
        }),
        event(4, 1_040, 'turn/start', { turn: 2 }),
        event(5, 1_050, 'step/start', { turn: 2, step: 1 }),
        event(6, 1_060, 'system/message', {
          turn: 2, step: 1,
          message: {
            id: 'system-2', role: 'system', source: { kind: 'plugin', plugin: 'test' },
            content: [{ type: 'text', text: 'system prompt' }],
          },
        }),
        event(7, 1_070, 'user/message', {
          id: 'user-2', role: 'user', content: [{ type: 'text', text: 'turn 2 prompt' }],
          source: { kind: 'user' },
        }),
        assistant(8, 1_080, 2, 1),
      ],
      expectedTurnOrder: [1, 2],
      expectedPlacements: [{ seq: 0, turn: 1 }, { seq: 7, turn: 2 }],
      expectedUpdatedSystemTurns: [2],
      expectedLocations: [],
    },
    {
      name: 'a user message after a turn-1 tail and turn-2 step start',
      events: [
        assistant(0, 1_050, 1, 1),
        event(1, 1_060, 'step/end', { turn: 1, step: 1 }),
        event(2, 1_060, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
        event(3, 1_070, 'step/start', { turn: 2, step: 1 }),
        event(4, 1_080, 'user/message', {
          id: 'user-2', role: 'user', content: [{ type: 'text', text: 'turn 2 prompt' }],
          source: { kind: 'user' },
        }),
      ],
      expectedTurnOrder: [1, 2],
      expectedPlacements: [{ seq: 4, turn: 2 }],
      expectedUpdatedSystemTurns: [],
      expectedLocations: [{ seq: 4, turn: 2, step: null }],
    },
    {
      name: 'a turn-2 tool result followed by turn 3',
      events: [
        event(0, 1_000, 'tool/result', {
          turn: 2, step: 4,
          message: {
            id: 'result-2', role: 'user', source: { kind: 'tool', callId: 'call-2' },
            content: [{
              type: 'tool-result', toolCallId: 'call-2',
              content: [{ type: 'text', text: 'turn 2 result' }], isError: false,
            }],
          },
        }),
        event(1, 1_010, 'turn/start', { turn: 3 }),
        event(2, 1_020, 'step/start', { turn: 3, step: 1 }),
        assistant(3, 1_030, 3, 1),
      ],
      expectedTurnOrder: [2, 3],
      expectedPlacements: [{ seq: 0, turn: 2 }],
      expectedUpdatedSystemTurns: [],
      expectedLocations: [{ seq: 0, turn: 2, step: 4 }],
    },
  ])('keeps window events in their recorded turns for $name', ({
    events, expectedTurnOrder, expectedPlacements, expectedUpdatedSystemTurns, expectedLocations,
  }) => {
    const snapshot = buildTrajectorySnapshot(events)
    const turns = deriveTrajectoryLayout({
      nodes: snapshot.eventNodes,
      systemPrompts: snapshot.systemPrompts,
      eventLocations: snapshot.eventLocations,
      partial: snapshot.partial,
      runningCalls: snapshot.runningCalls,
      requests: snapshot.requests,
      callSchemas: snapshot.callSchemas,
    }, t)
    const updatedSystemTurns = turns.flatMap(turn => turn.groups.flatMap(group => group.cells
      .filter(cell => cell.kind === 'system' && cell.text === t('layout.systemPromptUpdated'))
      .map(() => turn.turn)))

    expect(turns.map(turn => turn.turn)).toEqual(expectedTurnOrder)
    expect(updatedSystemTurns).toEqual(expectedUpdatedSystemTurns)
    expect(expectedPlacements.map(({ seq }) => ({
      seq,
      turn: turns.find(turn => turn.groups.some(group => group.cells.some(cell => cell.sourceSeq === seq)))?.turn,
    }))).toEqual(expectedPlacements)
    for (const { seq, turn, step } of expectedLocations) {
      expect(snapshot.eventLocations.get(SessionSeq(seq))).toMatchObject(step === null
        ? { kind: 'turn', turn: { turn } }
        : { kind: 'step', turn: { turn }, step: { step } })
    }
  })

  it('keeps a failed attempt turn visible before the next successful turn', () => {
    const snapshot = buildTrajectorySnapshot([
      event(0, 1_000, 'turn/start', { turn: 1 }),
      event(1, 1_010, 'step/start', { turn: 1, step: 1 }),
      event(2, 1_015, 'system/message', {
        turn: 1, step: 1,
        message: {
          id: 'system-1', role: 'system', source: { kind: 'plugin', plugin: 'test' },
          content: [{ type: 'text', text: 'system prompt' }],
        },
      }),
      event(3, 1_020, 'user/message', {
        id: 'user-1', role: 'user', content: [{ type: 'text', text: 'failed turn prompt' }],
        source: { kind: 'user' },
      }),
      event(4, 1_090, 'assistant/attempt', { turn: 1, step: 1, stream: [] }),
      event(5, 1_095, 'step/end', { turn: 1, step: 1 }),
      event(6, 1_100, 'turn/end', {
        turn: 1, reason: { kind: 'error', error: { code: 'PROVIDER', message: 'provider failed' } },
      }),
      event(7, 1_200, 'turn/start', { turn: 2 }),
      event(8, 1_210, 'step/start', { turn: 2, step: 1 }),
      event(9, 1_220, 'user/message', {
        id: 'user-2', role: 'user', content: [{ type: 'text', text: 'successful turn prompt' }],
        source: { kind: 'user' },
      }),
      assistant(10, 1_230, 2, 1),
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
    expect(snapshot.eventLocations.get(SessionSeq(3))).toMatchObject({ kind: 'turn', turn: { turn: 1 } })
    expect(snapshot.eventLocations.get(SessionSeq(4))).toMatchObject({ kind: 'step', turn: { turn: 1 }, step: { step: 1 } })
    expect(turns.map(turn => turn.turn)).toEqual([1, 2])
    expect(turns[0]?.groups.flatMap(group => group.cells)).toContainEqual(
      expect.objectContaining({ kind: 'system', sourceSeq: 2 }),
    )
    expect(turns.map(turn => ({
      turn: turn.turn,
      prompts: turn.groups.flatMap(group => group.cells)
        .filter(cell => cell.kind === 'user')
        .map(cell => cell.sourceSeq),
    }))).toEqual([
      { turn: 1, prompts: [3] },
      { turn: 2, prompts: [9] },
    ])
  })
})
