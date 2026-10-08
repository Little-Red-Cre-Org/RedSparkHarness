/**
 * Cordis-free session-title facts shared by the framework service and the
 * native consumer: the durable event, the provider contract, message
 * extraction, result validation, and the log fold.
 *
 * @module @deepseek-ai/dsh-session-title/facts
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { assertNever, deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { SessionSeq as brandSessionSeq } from '@deepseek-ai/dsh-session/types'
import { normalizeSessionTitle } from './normalize.ts'
import type {
  SessionTitleEventData,
  SessionTitleModelProvenance,
  SessionTitleSnapshot,
  SessionTitleSource,
  SessionTitleUserMessage,
  TitleInputState,
  TitleProjection,
} from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Latest-wins session title snapshot. Log-only: it never enters the model
     * surface or derived history.
     */
    'session/title': SessionTitleEventData
  }
}

/** The durable title event type, carrying this package's isolated SessionEventMap augmentation. */
export type SessionTitleEvent = SessionEvent<'session/title'>

/** Identifies one session-title provider registration. */
export type SessionTitleProviderId = Branded<'SessionTitleProviderId'>

/**
 * Brand a raw provider id.
 * @param id - stable non-empty provider identifier supplied by a plugin.
 * @returns the same string with the session-title provider brand.
 */
export function SessionTitleProviderId(id: string): SessionTitleProviderId {
  return id as SessionTitleProviderId
}

/** Automatic generation cadence owned by a registered provider. */
export type SessionTitleAutomaticMode = 'first-prompt' | 'all-prompts'

/** Provider output before service-owned normalization and log acceptance. */
export interface SessionTitleProviderResult {
  /** Proposed title text. */
  readonly title: string
  /** Exact seqs from `request.messages` used by this result. */
  readonly messageSeqs: readonly SessionSeq[]
  /** Auxiliary LLM route, when generation used a model. */
  readonly model?: SessionTitleModelProvenance
}

/**
 * Extract one eligible human text message from a session event.
 * @param event - logged session event.
 * @returns the message seq and joined text, or undefined when the event is not an eligible human prompt.
 */
export function sessionTitleUserMessageOf(event: SessionEvent): SessionTitleUserMessage | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  const content = event.data.content
  const text = content
    .filter((block): block is Extract<(typeof content)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  if (normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER).length === 0) return undefined
  return { seq: event.seq, text }
}

/**
 * Defensive copy of a logged title source (the snapshot must not alias log-owned objects).
 * @param source - logged title source.
 * @returns a structurally equal copy.
 */
export function copySessionTitleSource(source: SessionTitleSource): SessionTitleSource {
  switch (source.kind) {
    case 'fallback': return { kind: 'fallback' }
    case 'provider': return {
      kind: 'provider',
      provider: source.provider,
      ...(source.model === undefined ? {} : { model: { ...source.model } }),
    }
    case 'user': return { kind: 'user' }
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default: return assertNever(source, 'SessionTitleSource')
  }
}

/**
 * Collect eligible human text messages from a session log, in seq order.
 * @param events - the session event log.
 * @param throughSeq - optional inclusive upper seq bound.
 * @returns eligible messages with exact source seqs.
 */
export function collectSessionTitleMessages(
  events: readonly SessionEvent[],
  throughSeq?: SessionSeq,
): SessionTitleUserMessage[] {
  const messages: SessionTitleUserMessage[] = []
  for (const event of events) {
    if (throughSeq !== undefined && event.seq > throughSeq) break
    const message = sessionTitleUserMessageOf(event)
    if (message !== undefined) messages.push(message)
  }
  return messages
}

/**
 * Convert title projection state into an immutable snapshot.
 * @param state - the title unit's folded state.
 * @returns the immutable snapshot.
 */
export function titleSnapshotFromState(state: TitleProjection): SessionTitleSnapshot {
  return deepFreeze({
    title: state.title,
    messageSeqs: [...state.messageSeqs],
    source: copySessionTitleSource(state.source),
    eventSeq: state.eventSeq,
    updatedAt: state.updatedAt,
  })
}

/**
 * Fold the latest logged title without consulting mutable metadata.
 * @param events - live or persisted session log.
 * @returns the latest immutable title snapshot, or `undefined`.
 */
export function foldSessionTitle(events: readonly SessionEvent[]): SessionTitleSnapshot | undefined {
  const event = events.findLast(item => item.type === 'session/title')
  return event === undefined ? undefined : titleSnapshotOfEvent(event)
}

/**
 * Convert one logged `session/title` event into an immutable snapshot.
 * @param event - durable title event.
 * @returns the immutable snapshot.
 */
export function titleSnapshotOfEvent(event: Extract<SessionEvent, { type: 'session/title' }>): SessionTitleSnapshot {
  return titleSnapshotFromState({
    title: event.data.title,
    messageSeqs: event.data.messageSeqs,
    source: event.data.source,
    eventSeq: event.seq,
    updatedAt: event.time,
  })
}

/** Title input facts before any eligible human message. */
export const EMPTY_TITLE_INPUT: TitleInputState = deepFreeze({ first: null, count: 0, lastSeq: null })

/**
 * Fold one event into the title input facts: the first eligible message, the
 * eligible count, and the newest eligible seq. Shared by the Cordis
 * `titleInput` projection and the native owner fold.
 * @param state - facts folded so far.
 * @param event - next logged event.
 * @returns the advanced facts, or `state` itself when the event is not a new eligible message.
 */
export function foldTitleInput(state: TitleInputState, event: SessionEvent): TitleInputState {
  const message = sessionTitleUserMessageOf(event)
  if (message === undefined || (state.lastSeq !== null && message.seq <= state.lastSeq)) return state
  return { first: state.first ?? message, count: state.count + 1, lastSeq: message.seq }
}

/**
 * Validate and normalize provider output against the supplied message snapshot.
 * @param result - untrusted provider output.
 * @param messages - exact messages the provider was given.
 * @param maxTitleBytes - accepted title byte cap.
 * @returns the normalized result.
 */
export function validateSessionTitleResult(
  result: unknown,
  messages: readonly SessionTitleUserMessage[],
  maxTitleBytes: number,
): SessionTitleProviderResult {
  if (result === null || typeof result !== 'object') {
    throw new Error('session-title provider returned an invalid result')
  }
  const candidate = result as Record<string, unknown>
  if (typeof candidate.title !== 'string') throw new Error('session-title provider title must be a string')
  const title = normalizeSessionTitle(candidate.title, maxTitleBytes)
  if (title.length === 0) throw new Error('session-title provider returned an empty title')
  if (!Array.isArray(candidate.messageSeqs) || candidate.messageSeqs.length === 0) {
    throw new Error('session-title provider must identify at least one source message seq')
  }
  const messageSeqs: SessionSeq[] = []
  const order = new Map(messages.map((message, index) => [message.seq, index]))
  let previous = -1
  for (const seq of candidate.messageSeqs as unknown[]) {
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
      throw new Error('session-title provider messageSeqs must be unique, ordered seqs from the request')
    }
    const sessionSeq = brandSessionSeq(seq)
    const index = order.get(sessionSeq)
    if (index === undefined || index <= previous) {
      throw new Error('session-title provider messageSeqs must be unique, ordered seqs from the request')
    }
    messageSeqs.push(sessionSeq)
    previous = index
  }
  const modelCandidate = candidate.model
  let model: SessionTitleModelProvenance | undefined
  if (modelCandidate !== undefined) {
    if (modelCandidate === null || typeof modelCandidate !== 'object') {
      throw new Error('session-title provider result model must contain non-empty provider and model strings')
    }
    const record = modelCandidate as Record<string, unknown>
    if (typeof record.provider !== 'string' || record.provider.length === 0
      || typeof record.model !== 'string' || record.model.length === 0) {
      throw new Error('session-title provider result model must contain non-empty provider and model strings')
    }
    model = { provider: record.provider, model: record.model }
  }
  return { title, messageSeqs, ...(model === undefined ? {} : { model }) }
}

/** Required deterministic fallback and accepted-title limits. */
export interface SessionTitleConfig {
  /** Maximum whitespace-delimited words in the built-in fallback. */
  readonly fallbackMaxWords: number
  /** Maximum UTF-8 bytes in the built-in fallback. */
  readonly fallbackMaxBytes: number
  /** Maximum UTF-8 bytes in any accepted title. */
  readonly maxTitleBytes: number
}

/** Validate one positive integer configuration field. */
function assertPositiveInteger(name: keyof SessionTitleConfig, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-title: ${name} must be a positive integer`)
  }
}

/**
 * Validate the title service limits.
 * @param config - untrusted plugin configuration.
 * @returns detached validated limits.
 */
export function resolveSessionTitleConfig(config: unknown): SessionTitleConfig {
  if (config === null || typeof config !== 'object') {
    throw new Error('session-title: configuration is required')
  }
  const value = config as Partial<SessionTitleConfig>
  assertPositiveInteger('fallbackMaxWords', value.fallbackMaxWords as number)
  assertPositiveInteger('fallbackMaxBytes', value.fallbackMaxBytes as number)
  assertPositiveInteger('maxTitleBytes', value.maxTitleBytes as number)
  if ((value.fallbackMaxBytes as number) > (value.maxTitleBytes as number)) {
    throw new Error('session-title: fallbackMaxBytes must not exceed maxTitleBytes')
  }
  return deepFreeze({
    fallbackMaxWords: value.fallbackMaxWords as number,
    fallbackMaxBytes: value.fallbackMaxBytes as number,
    maxTitleBytes: value.maxTitleBytes as number,
  })
}
