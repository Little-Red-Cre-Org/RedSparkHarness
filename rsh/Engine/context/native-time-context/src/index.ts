/** Native durable request-time context with explicit time-zone configuration. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session/native'

/** Configuration for the native request-time context Provider. */
export interface Config {
  /** Fallback IANA zone for display when browser provenance is not unique; omission resolves the process zone at activation. */
  timeZone?: string
  /** Minimum milliseconds between readings in one Session; `0` injects before every step. */
  refreshIntervalMs?: number
}

/** One application request preparing an immediately durable time-context message. */
export interface NativeTimeContextRequest {
  /** Session that will append the returned message before model dispatch. */
  readonly session: Session
  /** Open Session turn receiving the message. */
  readonly turn: number
  /** Open Session step receiving the message. */
  readonly step: number
  /** New user messages proposed for this request that are not yet in the Session log. */
  readonly requestMessages?: readonly UserMessage[]
}

/** Resolved settings selected before the Provider becomes available. */
export interface ResolvedConfig {
  readonly timeZone: string
  readonly refreshIntervalMs: number
}

type TimestampPart = 'day' | 'hour' | 'minute' | 'month' | 'second' | 'timeZoneName' | 'year'
type BrowserTimeZoneContext =
  | { readonly kind: 'resolved'; readonly timeZone: string }
  | { readonly kind: 'mixed'; readonly timeZones: readonly string[] }
  | { readonly kind: 'missing' }

const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

function formatDuration(elapsedMs: number): string {
  let seconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  const days = Math.floor(seconds / 86_400)
  seconds %= 86_400
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

function createFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  })
}

function formatTimestamp(now: number, formatter: Intl.DateTimeFormat, timeZone: string): string {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value])) as Record<TimestampPart, string>
  const offset = parts.timeZoneName.replace(/^GMT$/, 'GMT+00:00').slice(3)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}[${timeZone}]`
}

function browserTimeZone(message: UserMessage): string | undefined {
  const source = message.source
  const value = source.kind === 'user'
    && 'rpcId' in source && typeof source.rpcId === 'string'
    && 'clientTimeZone' in source && typeof source.clientTimeZone === 'string'
    ? source.clientTimeZone
    : undefined
  if (value === undefined) return undefined
  if (value !== 'UTC' && !IANA_TIME_ZONE.test(value)) {
    throw new TypeError(`native-time-context: invalid browser time zone ${JSON.stringify(value)}`)
  }
  let canonical: string
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch (error) {
    throw new TypeError(`native-time-context: unsupported browser time zone ${JSON.stringify(value)}`, { cause: error })
  }
  if (canonical !== value) throw new TypeError(`native-time-context: browser time zone must be canonical: ${JSON.stringify(value)}`)
  return value
}

function browserContext(messages: readonly UserMessage[]): BrowserTimeZoneContext {
  const timeZones = [...new Set(messages.flatMap((message) => {
    const timeZone = browserTimeZone(message)
    return timeZone === undefined ? [] : [timeZone]
  }))].sort()
  const [timeZone, ...remaining] = timeZones
  if (timeZone === undefined) return { kind: 'missing' }
  if (remaining.length === 0) return { kind: 'resolved', timeZone }
  return { kind: 'mixed', timeZones }
}

function renderBrowserPolicy(context: BrowserTimeZoneContext): string {
  switch (context.kind) {
    case 'resolved':
      return `Browser time zone for this request: ${context.timeZone}. Interpret otherwise-unqualified dates and times in this zone.`
    case 'mixed':
      return `Browser time zone for this request: mixed ${JSON.stringify(context.timeZones)}. Ask the user to clarify otherwise-unqualified dates and times.`
    case 'missing':
      return 'Browser time zone for this request: unavailable. Ask the user to clarify otherwise-unqualified dates and times.'
    default: {
      const exhaustive: never = context
      throw new Error(`native-time-context: unknown browser zone context ${String(exhaustive)}`)
    }
  }
}

interface TimeFacts {
  lastMessageTime: number | undefined
  latestInjection: number | undefined
  latestTurnInjection: number | undefined
  activeTurn: number | undefined
  turnMessages: UserMessage[]
}

function applyEvent(state: TimeFacts, event: SessionEvent): void {
  if (event.type === 'turn/start') {
    state.activeTurn = event.data.turn
    state.latestTurnInjection = undefined
    state.turnMessages = []
  }
  if (event.type === 'turn/end') state.activeTurn = undefined
  if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result') {
    state.lastMessageTime = event.time
  }
  if (event.type !== 'user/message') return
  if (event.data.source.kind === 'plugin' && event.data.source.plugin === 'native-time-context') {
    state.latestInjection = event.time
    if (state.activeTurn !== undefined) state.latestTurnInjection = event.time
  }
  if (state.activeTurn !== undefined) state.turnMessages.push(event.data)
}

/**
 * Resolve static native time-context configuration before the Host admits the Provider.
 * @param input - optional installation configuration.
 * @returns validated values, including the canonical selected IANA zone.
 */
export function resolveNativeTimeContextConfig(input: unknown): ResolvedConfig {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('native-time-context: configuration must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  if (fields !== undefined && Object.keys(fields).some(key => key !== 'timeZone' && key !== 'refreshIntervalMs')) {
    throw new Error('native-time-context: unknown configuration field')
  }
  if (fields?.timeZone !== undefined && (typeof fields.timeZone !== 'string' || fields.timeZone.length === 0)) {
    throw new Error('native-time-context: timeZone must be a nonempty IANA zone string')
  }
  const refreshIntervalMs: unknown = fields?.refreshIntervalMs ?? 0
  if (typeof refreshIntervalMs !== 'number' || !Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 0) {
    throw new Error('native-time-context: refreshIntervalMs must be a non-negative safe integer')
  }
  try {
    const requestedTimeZone = fields?.timeZone
    const timeZone = new Intl.DateTimeFormat(
      undefined, requestedTimeZone === undefined ? {} : { timeZone: requestedTimeZone },
    ).resolvedOptions().timeZone
    return { timeZone, refreshIntervalMs }
  } catch (error) {
    throw new Error(`native-time-context: invalid IANA timeZone ${JSON.stringify(fields?.timeZone)}`, { cause: error })
  }
}

/** A native request-context Provider that produces one source-attributed durable message when due. */
export class NativeTimeContext {
  private readonly formatters = new Map<string, Intl.DateTimeFormat>()
  private readonly states = new WeakMap<Session, TimeFacts>()

  /** @param config - validated time-zone and refresh policy. @param now - wall-clock source for testable request readings. */
  constructor(private readonly config: ResolvedConfig, private readonly now: () => number = Date.now) {
    this.formatters.set(config.timeZone, createFormatter(config.timeZone))
  }

  /**
   * Restore the time projection from events already loaded by the Session owner.
   * @param session - exact Session receiving future model requests.
   * @param events - committed events in log order, or an empty array for a new Session.
   */
  seed(session: Session, events: readonly SessionEvent[]): void {
    if (this.states.has(session)) throw new Error('native-time-context: Session was already seeded')
    const state: TimeFacts = {
      lastMessageTime: undefined, latestInjection: undefined, latestTurnInjection: undefined,
      activeTurn: undefined, turnMessages: [],
    }
    for (const event of events) applyEvent(state, event)
    this.states.set(session, state)
  }

  /**
   * Advance the projection after one committed append.
   * @param session - exact seeded Session.
   * @param event - committed event from that Session.
   */
  record(session: Session, event: SessionEvent): void {
    const state = this.states.get(session)
    if (state === undefined) throw new Error('native-time-context: Session is not seeded')
    applyEvent(state, event)
  }

  /**
   * Return a durable source-attributed time message when the current turn is due for one.
   * @param request - Session and exact turn/step about to dispatch its model request.
   * @returns the message to append, or undefined when refresh policy suppresses it.
   */
  prepare(request: NativeTimeContextRequest): UserMessage | undefined {
    const now = this.now()
    const prior = this.states.get(request.session)
    if (prior === undefined || prior.activeTurn !== request.turn) {
      throw new Error('native-time-context: request turn is not active in the seeded Session')
    }
    if (prior.latestInjection !== undefined && this.config.refreshIntervalMs > 0
      && now >= prior.latestInjection && now - prior.latestInjection < this.config.refreshIntervalMs) {
      return undefined
    }
    const browser = browserContext([...prior.turnMessages, ...(request.requestMessages ?? [])])
    const timeZone = browser.kind === 'resolved' ? browser.timeZone : this.config.timeZone
    let formatter = this.formatters.get(timeZone)
    if (formatter === undefined) {
      formatter = createFormatter(timeZone)
      this.formatters.set(timeZone, formatter)
    }
    const previous = request.step === 1 ? prior.lastMessageTime : prior.latestTurnInjection
    const elapsed = previous === undefined ? 'unavailable' : formatDuration(now - previous)
    const baseline = request.step === 1 ? 'model-visible message' : 'step context'
    const text = `Time sampled while preparing turn ${request.turn}, step ${request.step}: ${formatTimestamp(now, formatter, timeZone)}\n`
      + `${renderBrowserPolicy(browser)}\n`
      + `Elapsed since the preceding ${baseline}: ${elapsed}.`
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'native-time-context', form: 'snapshot', sections: [{ name: 'native-time-context', text }] },
    })
  }
}

export { plugin } from './native.ts'
