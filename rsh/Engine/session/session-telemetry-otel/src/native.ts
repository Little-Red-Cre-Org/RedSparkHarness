/** Native FEEDBACK_ONLY OpenTelemetry Provider using accepted Session owners. */
import { createRequire } from 'node:module'
import { z } from 'zod'
import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { APP_IDENTITY } from '@deepseek-ai/dsh-llm/native'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionTelemetryRecord, SessionTelemetrySharingStatus } from '@deepseek-ai/dsh-session-telemetry/types'
import { isFeedbackEvent, ledgerRecord } from '@deepseek-ai/dsh-session-telemetry/records'
import {
  BatchLogRecordProcessor, LoggerProvider,
  type BatchLogRecordProcessorOptions,
} from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { SeverityNumber, type AnyValue } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'
import type { NativeFeedbackCommit } from '@deepseek-ai/dsh-command-feedback/native-definition'
import type {} from '@deepseek-ai/dsh-command-feedback/native-definition'
import type {} from '@deepseek-ai/dsh-message-feedback/native-definition'
import type {} from '@deepseek-ai/dsh-session-telemetry/native-definition'
import type {} from '@deepseek-ai/dsh-launch-environment/native'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }
type Mode = 'FEEDBACK_ONLY' | 'DISABLED'
interface Config {
  readonly mode: Mode
  readonly exporter?: OTLPExporterNodeConfigBase & { readonly url?: string }
  readonly processor?: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  readonly shutdownTimeoutMillis?: number
}

const configSchema = z.strictObject({
  mode: z.enum(['FEEDBACK_ONLY', 'DISABLED']).default('FEEDBACK_ONLY'),
  exporter: z.record(z.string(), z.unknown()).optional(),
  processor: z.record(z.string(), z.unknown()).optional(),
  shutdownTimeoutMillis: z.number().positive().optional(),
})
const severity = {
  info: { severityNumber: SeverityNumber.INFO, severityText: 'INFO' },
  warn: { severityNumber: SeverityNumber.WARN, severityText: 'WARN' },
  error: { severityNumber: SeverityNumber.ERROR, severityText: 'ERROR' },
} as const

/** Native backend plugin; only fresh, durable feedback authorizes its log prefix. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-telemetry-otel',
  targets: ['host'],
  requires: ['launchEnvironment'],
  optional: [],
  provides: ['sessionTelemetry'],
  resolve(input) {
    const config = configSchema.parse(input ?? {}) as Config
    return (context) => {
      const environment = context.require('launchEnvironment')
      const hardOff = (environment.getFrom('DSH_TELEMETRY_DISABLED', ['process'])?.value.length ?? 0) > 0
      const disabled = hardOff || config.mode === 'DISABLED'
      const telemetry = new NativeTelemetry(context, config, disabled)
      context.provide('sessionTelemetry', telemetry)
      const removeCommitted = context.on('feedback/committed', (commit) => {
        if (disabled) console.warn('session-telemetry: recorded feedback is not uploaded because telemetry is disabled')
        else return telemetry.acceptCommit(commit)
      })
      telemetry.observeCommits(removeCommitted)
      context.own(() => telemetry.shutdown())
    }
  },
}

class NativeTelemetry {
  readonly sharing: SessionTelemetrySharingStatus
  private readonly logger: ReturnType<LoggerProvider['getLogger']> | undefined
  private readonly provider: LoggerProvider | undefined
  private readonly cursors = new Map<SessionId, number>()
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly events: Pick<NativeContext['events'], 'waterfall'>
  private readonly shutdownTimeoutMillis: number
  private removeCommitted: (() => Promise<void>) | undefined
  private closed = false
  private closeResult: Promise<void> | undefined
  private shutdownResult: Promise<void> | undefined

  constructor(context: NativeContext, config: Config, disabled: boolean) {
    this.events = context.events
    if (disabled) {
      this.sharing = 'disabled'
      this.provider = undefined
      this.logger = undefined
      this.shutdownTimeoutMillis = 3_000
      return
    }
    const url = config.exporter?.url
    if (typeof url !== 'string' || url.length === 0) throw new Error('session-telemetry-otel: exporter.url is required')
    let parsed: URL
    try { parsed = new URL(url) }
    catch { throw new Error(`session-telemetry-otel: exporter.url is invalid: ${JSON.stringify(url)}`) }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`session-telemetry-otel: exporter.url must use http or https, got ${parsed.protocol}`)
    }
    const batchSize = config.processor?.maxExportBatchSize
    if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
      throw new Error(`session-telemetry-otel: processor.maxExportBatchSize must be positive, got ${String(batchSize)}`)
    }
    const timeout = config.shutdownTimeoutMillis ?? 3_000
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
      throw new Error('session-telemetry-otel: shutdownTimeoutMillis must be positive and fit a Node timer')
    }
    this.sharing = 'feedback-only'
    this.shutdownTimeoutMillis = timeout
    const exporter = new OTLPLogExporter({ ...config.exporter, url })
    const provider = new LoggerProvider({ resource: resourceFromAttributes({
      'service.name': APP_IDENTITY.product, 'service.version': APP_IDENTITY.version,
      'user.id': getOrCreateAnonymousUserId(),
    }), processors: [new BatchLogRecordProcessor({ ...config.processor, exporter })] })
    this.provider = provider
    this.logger = provider.getLogger('@deepseek-ai/dsh-session-telemetry-otel', version)
  }

  /** Direct records never authorize a prefix in FEEDBACK_ONLY mode. */
  emit(_record: SessionTelemetryRecord): void {}

  /** Retain the durable-commit observer until shutdown closes its admission. */
  observeCommits(remove: () => Promise<void>): void { this.removeCommitted = remove }

  /** Stop commit admission, drain accepted prefixes, then shut down the SDK exporter. */
  shutdown(): Promise<void> {
    if (this.closeResult !== undefined) return this.closeResult
    return this.closeResult = (async () => {
      await this.removeCommitted?.()
      this.closed = true
      await this.drainAndShutdown()
    })()
  }

  /** Accept one durable feedback mutation and serialize its canonical prefix by Session. */
  async acceptCommit(commit: NativeFeedbackCommit): Promise<void> {
    if (this.closed) return
    const { inspection } = commit
    const trigger = inspection.events.at(-1)
    if (trigger === undefined || !isFeedbackEvent(trigger, inspection.inheritedEventCount, inspection.meta.id)) return
    const sessionId = inspection.meta.id
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const operation = previous.then(async () => {
      const cursor = this.cursors.get(sessionId) ?? -1
      await this.capturePrefix(inspection.meta, inspection.inheritedEventCount, inspection.events,
        cursor, trigger.seq, commit.scope, (next) => { this.cursors.set(sessionId, next) })
    })
    const tail = operation.then(() => undefined, (error: unknown) => {
      console.warn(`session-telemetry: feedback capture failed: ${String(error)}`)
    })
    this.tails.set(sessionId, tail)
    await tail
    if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId)
  }

  private async capturePrefix(header: SessionHeader, inheritedEventCount: number, events: readonly SessionEvent[],
    cursor: number, through: number, subject: NativeContext['scope'], advance: (seq: number) => void): Promise<void> {
    for (const event of events) {
      if (event.seq <= cursor) continue
      if (event.seq > through) break
      const copy = ledgerRecord(header, inheritedEventCount, event)
      try {
        const redacted = await this.events.waterfall(subject, 'session-telemetry/record', () => copy, copy)
        const levels = severity[redacted.severity]
        this.logger?.emit({ timestamp: copy.time, observedTimestamp: copy.time,
          ...levels, body: redacted.body as AnyValue, attributes: redacted.attributes })
        advance(event.seq)
      } catch (error) {
        console.warn(`session-telemetry: record withheld by policy or backend: ${String(error)}`)
      }
    }
  }

  private async drainAndShutdown(): Promise<void> {
    await Promise.all(this.tails.values())
    await this.shutdownProvider()
  }

  private shutdownProvider(): Promise<void> {
    if (this.shutdownResult !== undefined) return this.shutdownResult
    if (this.provider === undefined) return this.shutdownResult = Promise.resolve()
    const providerShutdown = this.provider.shutdown()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`session-telemetry: exporter shutdown exceeded ${this.shutdownTimeoutMillis}ms`))
      }, this.shutdownTimeoutMillis)
    })
    this.shutdownResult = Promise.race([providerShutdown, deadline]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
    return this.shutdownResult
  }
}
