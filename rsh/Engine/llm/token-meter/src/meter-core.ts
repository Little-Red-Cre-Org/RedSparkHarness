/** Shared durable replay estimator used by native and compatibility Providers. */
import { assembleAssistantStream, type ContentBlock, type LlmImageRequestPricing, type Message, type TokenUsage } from '@deepseek-ai/dsh-llm/native'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { canonicalHeader, headerEquals, isSurfaceEvent, SessionLogOffset, SessionSeq, type EpochHeader, type Session, type SessionEvent, type SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session/native'
import type { TokenMeasurement, TokenMeasurementBaseline } from './meter-types.ts'
import { estimateContent, estimateMessage, estimateToolsTokens, ROLE_OVERHEAD } from './estimate.ts'
import { commitSurfaceTokens, planSurfaceTokens, type MeterSurfaceNode } from './surface-fold.ts'
import { priceSurface } from './route-pricing.ts'

/** Request pricing supplied by the selected implementation. */
export interface TokenMeterPorts {
  /**
   * @param provider - recorded provider route.
   * @param model - recorded model id.
   * @returns actual adapter pricing when declared.
   */
  imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined
  /** Resolve the exact file projection of the mounted runtime.
   * @returns file text projection when available.
   */
  fileRequestText?(): ((ref: Extract<ContentBlock, { type: 'file' }>['attachment']) => string) | undefined
}

/**
 * Raw anchor facts captured at the latest successful call; the baseline is
 * derived per measurement so the anchored surface reprices under the same
 * route pricing as the current surface it is compared with.
 */
interface MeasurementAnchor {
  readonly header: EpochHeader | undefined
  /** Priced surface immediately before the anchored assistant message commits. */
  readonly nodes: readonly MeterSurfaceNode[]
  /** Fixed-heuristic price of the call's provider output. */
  readonly assistantTokens: number
  /** Provider usage of the call, when it reported one under a known header. */
  readonly usage: TokenUsage | undefined
}

interface ReplayState {
  consumedEvents: SessionLogOffsetType
  header: EpochHeader | undefined
  surface: MeterSurfaceNode[]
  stepStart: { turn: number; step: number } | undefined
  anchor: MeasurementAnchor | undefined
}

/** Sum disjoint provider usage buckets without double-counting reasoning output. */
function usageTokens(usage: TokenUsage): number {
  return usage.inputTokens
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
    + usage.outputTokens
}

/** Compare optional envelopes so a headerless estimate can track later surface deltas. */
function optionalHeaderEquals(
  left: EpochHeader | undefined,
  right: EpochHeader | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return headerEquals(left, right)
}

/** Replay owner shared by both service implementations. */
export class ReplayTokenMeter {
  private readonly states = new WeakMap<Session, ReplayState>()
  /** @param ports - selected request-image and file projection implementation. */
  constructor(private readonly ports: TokenMeterPorts) {}
  /** Catch up only already-observed Sessions.
   * @param session - committed Session.
   */
  observe(session: Session): void { if (this.states.has(session)) this._sync(session) }

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
  measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement {
    const state = this._sync(session)
    const header = requestHeader === undefined
      ? state.header
      : canonicalHeader(requestHeader)
    const pricing = header === undefined ? undefined : this.ports.imageRequestPricing(header.config.provider, header.config.model)
    const fileText = this.ports.fileRequestText?.()
    const surface = priceSurface(state.surface, pricing, fileText)
    const anchor = state.anchor

    let baseline: TokenMeasurementBaseline
    let surfaceDeltaTokens: number
    if (anchor !== undefined && optionalHeaderEquals(anchor.header, header)) {
      // Matching headers share one route, so the anchored snapshot reprices
      // under the same pricing as the current surface and the signed delta
      // compares like with like.
      const anchorSurfaceTokens = priceSurface(anchor.nodes, pricing, fileText).surfaceTokens
        + anchor.assistantTokens
      const estimatedAnchorTokens = estimateToolsTokens(header) + anchorSurfaceTokens
      const usage = anchor.usage
      // Signed heuristic deltas remain conservative only from an anchor
      // that is at least as large as the matching full heuristic price.
      baseline = usage !== undefined && usageTokens(usage) >= estimatedAnchorTokens
        ? { kind: 'usage', tokens: usageTokens(usage), usage }
        : { kind: 'estimated', tokens: estimatedAnchorTokens }
      surfaceDeltaTokens = surface.surfaceTokens - anchorSurfaceTokens
    } else if (header === undefined && surface.surfaceTokens === 0) {
      baseline = { kind: 'none', tokens: 0 }
      surfaceDeltaTokens = 0
    } else {
      baseline = {
        kind: 'estimated',
        tokens: estimateToolsTokens(header) + surface.surfaceTokens,
      }
      surfaceDeltaTokens = 0
    }

    return deepFreeze(structuredClone({
      logRevision: state.consumedEvents,
      baseline,
      surfaceDeltaTokens,
      totalTokens: Math.max(0, baseline.tokens + surfaceDeltaTokens),
      surfaceTokens: surface.surfaceTokens,
      nodes: surface.nodes,
    }))
  }

  /**
   * Heuristically price one model-visible message (instance face of the pure
   * `estimateMessage` export from `estimate.ts`).
   * @param message - message to price without mutation.
   * @returns content and role-framing tokens under the fixed service heuristic.
   */
  estimateMessage(message: Message): number {
    return estimateMessage(message)
  }

  /** Catch one session's fold up to the current durable tail. */
  private _sync(session: Session): ReplayState {
    let state = this.states.get(session)
    if (state === undefined) {
      state = {
        consumedEvents: SessionLogOffset(0),
        header: undefined,
        surface: [],
        stepStart: undefined,
        anchor: undefined,
      }
      this.states.set(session, state)
    }

    while (state.consumedEvents < session.seq) {
      // Contiguous session seqs index the durable log; existing Session history read, migration deferred.
      // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
      const event = session.eventAt(SessionSeq(state.consumedEvents))!
      this._foldEvent(state, event)
      state.consumedEvents = SessionLogOffset(state.consumedEvents + 1)
    }
    return state
  }

  /**
   * Run every fallible step — surface plan and anchor validation — before
   * mutating replay state, so a malformed event remains unread on every
   * retry instead of half-applying.
   */
  private _foldEvent(state: ReplayState, event: SessionEvent): void {
    let nextHeader = state.header
    let nextStepStart = state.stepStart
    let nextAnchor = state.anchor

    switch (event.type) {
      case 'request/header':
        nextHeader = canonicalHeader(event.data.header)
        break
      case 'step/start':
        if (state.stepStart !== undefined) {
          throw new Error(
            `token meter: step/start at seq ${event.seq} arrived before turn ${state.stepStart.turn}/step ${state.stepStart.step} ended`,
          )
        }
        nextStepStart = { ...event.data }
        break
      case 'step/end':
        if (state.stepStart === undefined
          || state.stepStart.turn !== event.data.turn
          || state.stepStart.step !== event.data.step) {
          throw new Error(`token meter: step/end at seq ${event.seq} has no matching step/start event`)
        }
        nextStepStart = undefined
        break
      default:
        break
    }

    const plan = isSurfaceEvent(event)
      ? planSurfaceTokens(state.surface, event)
      : undefined

    if (event.type === 'assistant/message') {
      const stepStart = state.stepStart
      if (stepStart === undefined
        || stepStart.turn !== event.data.turn
        || stepStart.step !== event.data.step) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} has no matching step/start event`)
      }

      // assistant/message is surface-mandatory at every append/seed boundary.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const eventTokens = plan!.tokens
      // The loop admits prompts and user messages after step/start; retries may
      // replace them before succeeding. Only the pre-assistant surface is priced
      // by this call. Provider output stays separate from durable output rewrites.
      if (event.data.usage !== undefined && nextHeader !== undefined) {
        nextAnchor = {
          header: nextHeader,
          nodes: [...state.surface],
          assistantTokens: this._estimateProviderAssistant(event),
          usage: event.data.usage,
        }
      } else {
        nextAnchor = {
          header: nextHeader,
          nodes: [...state.surface],
          assistantTokens: eventTokens,
          usage: undefined,
        }
      }
    }

    state.header = nextHeader
    state.stepStart = nextStepStart
    if (plan !== undefined) {
      commitSurfaceTokens(state.surface, plan)
    }
    state.anchor = nextAnchor
  }

  /**
   * Reassemble provider output from the message's exact embedded stream.
   */
  private _estimateProviderAssistant(
    event: SessionEvent<'assistant/message'>,
  ): number {
    const providerContent = assembleAssistantStream(event.data.stream).blocks()
    return providerContent.length === 0 ? 0 : estimateContent(providerContent) + ROLE_OVERHEAD
  }
}
