/** Compatibility token-meter Service and Session projection installation. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EpochHeader, Session } from '@deepseek-ai/dsh-session'
import type { Message } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { TokenMeterConfig, TokenMeasurement } from './types.ts'
import { contextBreakdownProjectionDefinition } from './breakdown-projection.ts'
import { contextPressureProjectionDefinition, tokenUsageProjectionDefinition } from './usage-projection.ts'
import { ReplayTokenMeter } from './meter-core.ts'
export type * from './types.ts'
export type * from './usage-projection.ts'
export type * from './breakdown-projection.ts'

/** Reject stale or misspelled keys before defaults can hide them. */
function validateConfigKeys(config: TokenMeterConfig): void {
  for (const key of Object.keys(config)) {
    throw new Error(`TokenMeterConfig: unknown key "${key}" (no settings are supported)`)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenMeter: TokenMeter
  }
}

/** Replay owner for one service-wide estimator and isolated per-session folds. */
export class TokenMeter extends Service {
  static Config: z<TokenMeterConfig> = z.object({}) as unknown as z<TokenMeterConfig>
  static inject = ['sessionProjections']
  private readonly meter: ReplayTokenMeter
  constructor(ctx: Context, config: TokenMeterConfig = {}) {
    super(ctx, 'tokenMeter')
    validateConfigKeys(config)
    this.meter = new ReplayTokenMeter({
      imageRequestPricing: (provider, model) => ctx.get('llm')?.imageRequestPricing(provider, model),
      fileRequestText: () => {
        const llm = ctx.get('llm')
        return llm === undefined ? undefined : ref => llm.fileRequestText(ref)
      },
    })
    ctx.sessionProjections.register(tokenUsageProjectionDefinition)
    ctx.sessionProjections.register(contextPressureProjectionDefinition)
    ctx.sessionProjections.register(contextBreakdownProjectionDefinition)
    ctx.on('session/event', (session) => { this.meter.observe(session) })
  }
  /**
   * Measure current request pressure and surface through the durable tail.
   *
   * The effective envelope's routed provider/model selects the request-image
   * pricing every node is priced under: a route whose adapter declares image
   * pricing charges each retained image its visual tokens plus its
   * model-visible text, while other routes keep the fixed heuristic. Provider
   * usage is reused only when the latest successful call's canonical request
   * envelope matches `requestHeader` and its total is no lower than that
   * call's full route-priced anchor; otherwise the complete envelope and
   * surface are repriced. The anchor includes all surface nodes immediately
   * before the assistant message, including inputs admitted after step/start.
   *
   * `requestHeader` replaces the latest logged envelope for pressure and node
   * pricing; the node set always describes the current session surface. Every
   * call clones those positional nodes, so measurement is O(surface).
   *
   * @param session - session to replay through its current durable tail.
   * @param requestHeader - optional effective request envelope replacing the latest logged header.
   * @returns a detached deeply immutable pressure and surface measurement.
   */
  measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement { return this.meter.measure(session, requestHeader) }
  /**
   * Heuristically price one model-visible message (instance face of the pure
   * `estimateMessage` export from `estimate.ts`).
   * @param message - message to price without mutation.
   * @returns content and role-framing tokens under the fixed service heuristic.
   */
  estimateMessage(message: Message): number { return this.meter.estimateMessage(message) }
}
export default TokenMeter
