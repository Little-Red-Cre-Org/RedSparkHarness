/** Native-safe turn and step boundary projection shared by query consumers. */

import { z } from 'zod'
import { SessionSeq } from '@deepseek-ai/dsh-session/native'
import type { OptionalSessionSeq, SessionEvent, SessionSeq as SessionSeqValue } from '@deepseek-ai/dsh-session/native'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection/definition'

/** Turn and step boundaries folded from one agent session log. */
export interface TurnBoundaryProjection {
  /** Seq of the open turn's `turn/start`, or null between turns. */
  readonly openTurnStartSeq: OptionalSessionSeq
  /** Seq of the latest `step/start` event, or null before the first step. */
  readonly lastStepStartSeq: OptionalSessionSeq
  /** The latest step boundary (`step/start` or `step/end`) and its seq, or null before the first step boundary. */
  readonly lastStepBoundary: { readonly kind: 'start' | 'end'; readonly seq: SessionSeqValue } | null
  /** Turn number of the latest `turn/start`; 0 before the first turn. */
  readonly lastTurn: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Open turn and most recent step boundaries for agent-session tools. */
    turnBoundary: TurnBoundaryProjection
  }
}

const schema: z.ZodType<TurnBoundaryProjection> = z.object({
  openTurnStartSeq: z.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepStartSeq: z.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepBoundary: z.object({
    kind: z.union([z.literal('start'), z.literal('end')]),
    seq: z.number().int().nonnegative().transform(SessionSeq),
  }).nullable(),
  lastTurn: z.number().int().nonnegative(),
})

/** Canonical stateVersion 2 fold over committed turn and step events. */
export const turnBoundaryProjectionDefinition = {
  key: 'turnBoundary',
  stateVersion: 2,
  stateSchema: schema,
  init: () => ({ openTurnStartSeq: null, lastStepStartSeq: null, lastStepBoundary: null, lastTurn: 0 }),
  apply(state, event: SessionEvent) {
    switch (event.type) {
      case 'turn/start':
        return { ...state, openTurnStartSeq: event.seq, lastTurn: event.data.turn }
      case 'turn/end':
        return { ...state, openTurnStartSeq: null }
      case 'step/start':
        return { ...state, lastStepStartSeq: event.seq, lastStepBoundary: { kind: 'start' as const, seq: event.seq } }
      case 'step/end':
        return { ...state, lastStepBoundary: { kind: 'end' as const, seq: event.seq } }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'turnBoundary', TurnBoundaryProjection>
