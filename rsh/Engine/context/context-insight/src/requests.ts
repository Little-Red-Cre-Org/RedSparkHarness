/**
 * Durable per-request context growth for one Session.
 *
 * The composition projection answers "what is in the context now". This one answers "how did it
 * get there": one row per model request with the message and tool counts that were actually sent,
 * so a spike can be traced to the step that caused it.
 *
 * @module @deepseek-ai/dsh-context-insight/requests
 */

import { z } from 'zod'

/** One model request as the Session logged it. */
export interface RequestRow {
  readonly seq: number
  readonly time: number
  readonly reason: 'initial' | 'resume' | 'change' | 'series'
  readonly provider?: string
  readonly model?: string
  readonly tools: number
  readonly systemChars: number
  /** True when this request began a distinct message series, so a viewer can draw a boundary. */
  readonly startsSeries: boolean
}

/** Durable request history for one Session. */
export interface RequestHistoryState {
  readonly rows: readonly RequestRow[]
  readonly lastSeriesStart: number
}

/**
 * The state a Session starts from before any request is logged.
 * @returns an empty history with no series boundary.
 */
export function initialRequestHistoryState(): RequestHistoryState {
  return { rows: [], lastSeriesStart: 0 }
}

/**
 * Fold one Session event into the request history.
 * @param state - current state.
 * @param event - the next durable event.
 * @returns the next state; the same object when the event is not a request boundary.
 */
export function applyRequestHistoryEvent(
  state: RequestHistoryState,
  event: { readonly type: string; readonly seq: number; readonly time: number; readonly data: unknown },
): RequestHistoryState {
  if (event.type !== 'request/header') return state
  const data = event.data as Record<string, unknown> | undefined
  const header = data?.['header'] as {
    config?: { provider?: string; model?: string }
    tools?: readonly unknown[]
  } | undefined
  const reasonValue = data?.['reason']
  const reason: RequestRow['reason'] = reasonValue === 'initial' || reasonValue === 'resume'
    || reasonValue === 'change' || reasonValue === 'series' ? reasonValue : 'series'
  const config = header?.config
  const row: RequestRow = {
    seq: event.seq,
    time: event.time,
    reason,
    tools: (header?.tools ?? []).length,
    // The system prompt is logged separately; an empty count here means "unchanged since the
    // last series boundary", which is exactly what a reader needs to see.
    systemChars: 0,
    startsSeries: reason === 'series' || data?.['startsSeries'] === true,
    ...config?.provider === undefined ? {} : { provider: config.provider },
    ...config?.model === undefined ? {} : { model: config.model },
  }
  return {
    rows: [...state.rows, row],
    lastSeriesStart: row.startsSeries ? event.seq : state.lastSeriesStart,
  }
}

/** Durable-state schema. */
export const requestHistoryStateSchema = z.object({
  rows: z.array(z.object({
    seq: z.number(),
    time: z.number(),
    reason: z.enum(['initial', 'resume', 'change', 'series']),
    provider: z.string().optional(),
    model: z.string().optional(),
    tools: z.number(),
    systemChars: z.number(),
    startsSeries: z.boolean(),
  })),
  lastSeriesStart: z.number(),
}) as z.ZodType<RequestHistoryState>
