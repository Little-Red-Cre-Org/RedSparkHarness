/** Pure projection from accepted Session events to copied outbound records. */
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionTelemetryRecord, SessionTelemetrySeverity } from './types.ts'
import type {} from '@deepseek-ai/dsh-command-feedback/native-definition'
import type {} from '@deepseek-ai/dsh-message-feedback/native-definition'

/**
 * Map the event's recorded failure status to telemetry severity.
 * @param event - canonical Session event.
 * @returns mapped alerting severity.
 */
export function severityOf(event: SessionEvent): SessionTelemetrySeverity {
  switch (event.type) {
    case 'tool/result': return event.data.message.content[0].isError === true ? 'error' : 'info'
    case 'turn/end': return event.data.reason.kind === 'error' ? 'error' : 'info'
    default: return 'info'
  }
}

/**
 * Identify feedback outside the inherited prefix that belongs to this Session.
 * @param event - candidate accepted event.
 * @param inheritedEventCount - exact fork prefix.
 * @param sessionId - current Session identity.
 * @returns whether fresh Session-owned feedback authorizes this prefix.
 */
export function isFeedbackEvent(event: SessionEvent, inheritedEventCount: number, sessionId: SessionId): boolean {
  if (event.seq < inheritedEventCount) return false
  switch (event.type) {
    case 'feedback/record': return true
    case 'feedback/message-put':
    case 'feedback/message-delete': return event.data.sessionId === sessionId
    default: return false
  }
}

/**
 * Copy an accepted Session event into an outbound ledger record.
 * @param header - canonical Session metadata.
 * @param inheritedEventCount - exact fork prefix.
 * @param event - accepted event.
 * @returns an independent ledger record.
 */
export function ledgerRecord(header: SessionHeader, inheritedEventCount: number, event: SessionEvent): SessionTelemetryRecord {
  const attributes: Record<string, string | number> = {
    'session.id': String(header.id), 'session.format_version': header.version,
    'event.type': event.type, 'event.seq': event.seq,
  }
  if (header.cwd !== undefined) attributes['session.cwd'] = header.cwd
  if (header.parentSession !== undefined) attributes['session.parent_id'] = String(header.parentSession)
  if (header.isSeeded) attributes['session.seed_length'] = inheritedEventCount
  return { channel: 'ledger', time: event.time, severity: severityOf(event), attributes, body: structuredClone(event.data) }
}
