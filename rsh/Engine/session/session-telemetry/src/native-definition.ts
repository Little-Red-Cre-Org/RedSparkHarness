/** Native telemetry service and copied-record redaction Definition. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SessionTelemetryRecord, SessionTelemetrySharingStatus } from './types.ts'

/** Native telemetry service provided by an explicitly selected backend. */
export interface NativeSessionTelemetryOperations {
  /** Selected sharing policy; this does not confirm collector delivery. */
  readonly sharing: SessionTelemetrySharingStatus
  /** @param record - direct submissions are refused by FEEDBACK_ONLY backends. */
  emit(record: SessionTelemetryRecord): void
  /** @returns completion after accepted exporter work has drained. */
  shutdown(): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionTelemetry: NativeSessionTelemetryOperations }
  interface NativeEvents {
    /** Redact one copied candidate before the telemetry backend receives it. @param record - independent outbound copy. @mode waterfall */
    'session-telemetry/record': { mode: 'waterfall'; args: [record: SessionTelemetryRecord]; result: SessionTelemetryRecord }
  }
}

export type { NativePlugin }
