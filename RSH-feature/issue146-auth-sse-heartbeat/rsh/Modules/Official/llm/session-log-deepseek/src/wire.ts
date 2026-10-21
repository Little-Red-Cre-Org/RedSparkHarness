/** Cordis-free acceptance folding and wire conversion shared by both request Consumers. */
import { KNOWN_SESSION_EVENT_TYPES, SessionSeq } from '@deepseek-ai/dsh-session/native'
import type { Session, SessionEvent, SessionId, SessionSeq as SessionSeqType, SessionSeqCursor, SurfaceOp } from '@deepseek-ai/dsh-session/native'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  DeepSeekSessionLogExtension,
  DeepSeekSessionLogWireEvent,
  DeepSeekSessionLogWireHeader,
  DeepSeekSessionLogWireSurfaceOp,
} from './types.ts'

/** Fold the greatest accepted watermark for one Session generation.
 * @param sessionId - exact canonical Session ID whose markers count.
 * @param formatVersion - Session header generation whose markers count.
 * @param events - canonical events in sequence order.
 * @param initialThrough - previously folded watermark, or `-1`.
 * @returns greatest matching accepted sequence.
 */
export function foldAcceptedThrough(
  sessionId: SessionId,
  formatVersion: number,
  events: Iterable<SessionEvent>,
  initialThrough: SessionSeqCursor = -1,
): SessionSeqCursor {
  let throughSeq = initialThrough
  for (const event of events) {
    if (event.type !== 'session-log-deepseek/delivery-accepted') continue
    const acceptedFormatVersion = event.data.sessionFormatVersion ?? 0
    if (!Number.isSafeInteger(acceptedFormatVersion)
      || acceptedFormatVersion < 0
      || Object.is(acceptedFormatVersion, -0)) {
      throw new Error(`session-log-deepseek: malformed acceptance format version at seq ${event.seq}`)
    }
    if (acceptedFormatVersion !== formatVersion) continue
    let acceptedSeq: SessionSeqType
    try {
      acceptedSeq = SessionSeq(event.data.throughSeq)
    } catch {
      throw new Error(`session-log-deepseek: malformed acceptance watermark at seq ${event.seq}`)
    }
    if (typeof event.data.sessionId !== 'string' || event.data.sessionId.length === 0
      || acceptedSeq >= event.seq) {
      throw new Error(`session-log-deepseek: malformed acceptance watermark at seq ${event.seq}`)
    }
    if (event.data.sessionId === sessionId && acceptedSeq > throughSeq) throughSeq = acceptedSeq
  }
  return throughSeq
}

/**
 * Translate logical Session metadata to raw external request fields.
 * @param session - canonical header and inherited-prefix metadata.
 * @returns the version-1 wire header.
 */
export function wireHeader(session: Pick<Session, 'header' | 'inheritedEventCount'>): DeepSeekSessionLogWireHeader {
  const header = session.header
  return {
    version: header.version,
    id: String(header.id),
    createdAt: header.createdAt,
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    ...header.parentSession === undefined ? {} : { parentSession: String(header.parentSession) },
    ...header.isSeeded ? { seedLength: Number(session.inheritedEventCount) } : {},
    ...header.origin === undefined ? {} : { origin: header.origin },
    ...header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth },
    ...header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset },
  }
}

/**
 * Translate a canonical event to raw numeric request fields.
 * @param event - canonical session event.
 * @returns the lossless external wire event.
 */
export function wireEvent(event: SessionEvent): DeepSeekSessionLogWireEvent {
  const common = {
    seq: Number(event.seq),
    time: event.time,
    data: event.data as JsonValue,
    ...event.ignorable === undefined ? {} : { ignorable: event.ignorable },
  }
  switch (event.type) {
    case 'system/message':
    case 'user/message':
    case 'tool/result':
      return {
        ...common,
        type: event.type,
        surfaceOp: wireSurfaceOp(event.surfaceOp),
        ...event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs.map(Number) },
      }
    case 'assistant/message':
      return { ...common, type: event.type, surfaceOp: wireSurfaceOp(event.surfaceOp) }
    default: {
      // Restored unknown ignorable records are opaque, not current surface events.
      if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === true) {
        const opaque = event as { surfaceOp?: JsonValue; sourceEventSeqs?: JsonValue }
        return {
          ...common, type: event.type, ignorable: true,
          ...opaque.surfaceOp === undefined ? {} : { surfaceOp: opaque.surfaceOp },
          ...opaque.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: opaque.sourceEventSeqs },
        }
      }
      return { ...common, type: event.type }
    }
  }
}

/** Translate one Session surface operation to its raw-number wire form. */
function wireSurfaceOp(op: SurfaceOp): DeepSeekSessionLogWireSurfaceOp {
  return op === 'append'
    ? op
    : { op: 'replace', startSeq: Number(op.startSeq), endSeq: Number(op.endSeq) }
}

/**
 * Build the contiguous version-1 suffix from one captured event snapshot.
 * @param session - canonical header and inherited-prefix metadata.
 * @param events - one durable or canonical event snapshot in sequence order.
 * @param afterSeq - highest sequence already accepted by the endpoint.
 * @returns the wire field and its exact final included sequence, or `undefined` for an empty suffix.
 */
export function wireUpload(
  session: Pick<Session, 'header' | 'inheritedEventCount'>,
  events: readonly SessionEvent[],
  afterSeq: SessionSeqCursor,
): { readonly value: DeepSeekSessionLogExtension; readonly throughSeq: SessionSeqType } | undefined {
  const suffix = events.slice(Number(afterSeq) + 1)
  const throughSeq = suffix.at(-1)?.seq
  if (throughSeq === undefined) return undefined
  return {
    value: {
      version: 1,
      sessionFormatVersion: session.header.version,
      session: wireHeader(session),
      afterSeq: Number(afterSeq),
      throughSeq: Number(throughSeq),
      events: suffix.map(wireEvent),
    },
    throughSeq,
  }
}
