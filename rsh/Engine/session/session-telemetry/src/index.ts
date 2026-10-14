/** Cordis SessionTelemetryBackend Definition and coordinator export. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionTelemetryRecord, SessionTelemetrySharingStatus, SessionTelemetrySink } from './types.ts'

export type { SessionTelemetryRecord, SessionTelemetrySeverity, SessionTelemetrySharingStatus, SessionTelemetrySink } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTelemetry: SessionTelemetryBackend
  }

  interface Events {
    /**
     * Transform one outbound record before it reaches the backend. This
     * waterfall is the Service Definition's redaction extension point. It ships NO rules
     * of its own: the
     * innermost `next()` passes the record through unchanged, and with no
     * listener mounted records reach the backend as captured, so exported
     * data is exactly as clean as the rules a deployment mounts. Listeners
     * stack by transforming `next()`'s return value; returning without
     * `next()` replaces everything beneath. Dispatched synchronously on the
     * capture hot path inside the coordinator's containment: a throwing
     * listener withholds that one record (fail-closed) and never reaches the
     * agent loop. Live capture dispatches at append time; on-demand capture
     * dispatches while reading the canonical log. Redaction applies to the
     * exported copy only; the canonical session log is never rewritten.
     * @param record - the candidate record, already the coordinator's own deep
     *   copy; listeners return a (possibly new) record and must not mutate it.
     * @mode waterfall
     */
    'session-telemetry/record'(record: SessionTelemetryRecord, next: () => SessionTelemetryRecord): SessionTelemetryRecord
  }
}

/**
 * Loadable form of the backend contract: one implementation per context —
 * the cordis `Service` registration under the `telemetry` key throws on a
 * duplicate, cordis' standard behavior. A backend composes a
 * {@link SessionTelemetryCoordinator} in its constructor to install the capture side.
 */
export abstract class SessionTelemetryBackend extends Service implements SessionTelemetrySink {
  constructor(ctx: Context) {
    super(ctx, 'sessionTelemetry')
  }

  /**
   * Deployment-selected sharing mode, independent of SDK delivery.
   */
  abstract readonly sharing: SessionTelemetrySharingStatus

  /**
   * See {@link SessionTelemetrySink.emit} — that declaration is the contract's one home.
   * @param record - the logical record to report; owned by the backend after the call.
   */
  abstract emit(record: SessionTelemetryRecord): void

  /** See {@link SessionTelemetrySink.flush}. */
  flush?(): void

  /**
   * See {@link SessionTelemetrySink.shutdown}.
   * @returns resolves when the backend's pipeline has quiesced.
   */
  abstract shutdown(): Promise<void>
}

export { SessionTelemetryCoordinator, type SessionTelemetryCapture, type SessionTelemetryCaptureOptions } from './coordinator.ts'
