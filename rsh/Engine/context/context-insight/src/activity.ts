/**
 * Durable per-day activity for one Session.
 *
 * Folding activity per day is what lets a cross-session view answer "how much did I use, and
 * when" without loading every Session log each time: the roster reads this projection's state.
 *
 * @module @deepseek-ai/dsh-context-insight/activity
 */

import { z } from 'zod'

/** One day's activity for a single Session. */
export interface ActivityDay {
  /** Characters the model consumed that day, the unit every other count is reported in. */
  readonly chars: number
  readonly requests: number
  readonly turns: number
  readonly toolCalls: number
  /** Requests that day, so a caller can tell a long single turn from many short ones. */
  readonly steps: number
}

/** Durable activity state for one Session. */
export interface ActivityState {
  /** Keyed by the local `YYYY-MM-DD` of the event. */
  readonly days: Readonly<Record<string, ActivityDay>>
}

/** The state a Session starts from. */
export function initialActivityState(): ActivityState {
  return { days: {} }
}

/**
 * The calendar day an event belongs to.
 *
 * A Session's activity is read by a human in their own day boundaries, so this uses the local
 * date rather than UTC; the alternative files an evening's work under tomorrow.
 * @param time - epoch milliseconds.
 * @returns `YYYY-MM-DD` in the local zone.
 */
export function dayKey(time: number): string {
  const date = new Date(time)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Add to one day's counters, creating the row when the day is new. */
function bump(
  days: Readonly<Record<string, ActivityDay>>,
  time: number,
  change: Partial<ActivityDay>,
): Record<string, ActivityDay> {
  const key = dayKey(time)
  const current = days[key] ?? { chars: 0, requests: 0, turns: 0, toolCalls: 0, steps: 0 }
  return {
    ...days,
    [key]: {
      chars: current.chars + (change.chars ?? 0),
      requests: current.requests + (change.requests ?? 0),
      turns: current.turns + (change.turns ?? 0),
      toolCalls: current.toolCalls + (change.toolCalls ?? 0),
      steps: current.steps + (change.steps ?? 0),
    },
  }
}

/** Non-whitespace-sensitive character count of a message's text parts. */
function messageChars(data: Record<string, unknown> | undefined): number {
  const message = data?.['message'] as { content?: readonly { type: string; text?: string }[] } | undefined
  return (message?.content ?? []).reduce((sum, part) => sum + (part.type === 'text' ? part.text?.length ?? 0 : 0), 0)
}

/**
 * Fold one Session event into the activity state.
 * @param state - current state.
 * @param event - the next durable event.
 * @returns the next state; the same object when the event carries no activity.
 */
export function applyActivityEvent(
  state: ActivityState,
  event: { readonly type: string; readonly time: number; readonly data: unknown },
): ActivityState {
  const data = event.data as Record<string, unknown> | undefined
  switch (event.type) {
    case 'turn/start':
      return { days: bump(state.days, event.time, { turns: 1 }) }
    case 'step/start':
      return { days: bump(state.days, event.time, { steps: 1 }) }
    case 'request/header':
      // Message growth is charged to the request that carried it, which is the only place the
      // model actually paid for it.
      return { days: bump(state.days, event.time, { requests: 1 }) }
    case 'user/message':
    case 'system/message':
    case 'assistant/message': {
      const chars = messageChars(data)
      return chars === 0 ? state : { days: bump(state.days, event.time, { chars }) }
    }
    case 'tool/call':
      return { days: bump(state.days, event.time, { toolCalls: 1 }) }
    case 'tool/result': {
      const result = data?.['result'] as { content?: readonly { type: string; text?: string }[] } | undefined
      const chars = (result?.content ?? []).reduce((sum, part) => sum + (part.type === 'text' ? part.text?.length ?? 0 : 0), 0)
      return chars === 0 ? state : { days: bump(state.days, event.time, { chars }) }
    }
    default:
      return state
  }
}

/** Durable-state schema. */
export const activityStateSchema = z.object({
  days: z.record(z.string(), z.object({
    chars: z.number(), requests: z.number(), turns: z.number(), toolCalls: z.number(), steps: z.number(),
  })),
})
