/** Framework-independent durable model choice and advisory catalog values. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete validated selection for subsequent prompt assembly; excluded from model history. */
    'model/selection': ModelSelection
  }
}

/** Complete provider route and request controls for one Session. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly maxTokens?: number
}

/** Durable last request and unconsumed later choice. */
export interface ModelSelectionProjectionState {
  readonly lastUsed: ModelSelection | null
  readonly pending: ModelSelection | null
}

/** Read-only next-request choice reconstructed from Session events. */
export interface ModelSelectionProjection {
  readonly lastUsed: ModelSelection | null
  readonly next: ModelSelection | null
}

/** One provider-owned reasoning effort. */
export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Reasoning options declared by an exact model. */
export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

/** One advertised model; catalog membership does not determine routability. */
export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: ModelReasoning
}

/** Advertised models belonging to one configured provider route. */
export interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
}

/** Isolated failure while reading one provider's advisory catalog. */
export interface ModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

/** Provider facts and the explicitly supplied Program default for unconfigured Sessions. */
export interface ModelCatalog {
  readonly default: ModelSelection
  readonly routableProviders: readonly string[]
  readonly groups: readonly ModelProviderGroup[]
  readonly failures: readonly ModelCatalogFailure[]
}

/** Compare complete model choices, including the absence of an explicit reasoning effort.
 * @param left - first choice, or no recorded choice.
 * @param right - second choice, or no recorded choice.
 * @returns whether every routing field agrees.
 */
export function sameModelSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || left !== null && right !== null && left.provider === right.provider
    && left.model === right.model && left.reasoningEffort === right.reasoningEffort && left.maxTokens === right.maxTokens
}

/** Advance selection intent and request-use facts from one validated durable event.
 * @param state - previous durable selection projection.
 * @param event - next event in Session log order.
 * @returns unchanged or updated selection facts; unrelated extension events are ignored.
 */
export function applyModelSelectionProjection(state: ModelSelectionProjectionState, event: SessionEvent): ModelSelectionProjectionState {
  if (event.type === 'model/selection') {
    return sameModelSelection(state.pending, event.data) ? state : { lastUsed: state.lastUsed, pending: event.data }
  }
  if (event.type !== 'request/header') return state
  const config = event.data.header.config
  const adapterDefaults = event.data.header.adapterDefaults
  const lastUsed: ModelSelection = { provider: config.provider, model: config.model,
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) },
    ...adapterDefaults?.maxTokens === true || config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens } }
  const pending = sameModelSelection(state.pending, lastUsed) ? null : state.pending
  return sameModelSelection(state.lastUsed, lastUsed) && pending === state.pending ? state : { lastUsed, pending }
}

/** Reconstruct selection from a complete validated Session prefix, including inherited fork events.
 * @param events - complete event prefix in durable order.
 * @returns last request route and the next choice, without inventing a default.
 */
export function foldModelSelection(events: readonly SessionEvent[]): ModelSelectionProjection {
  let state: ModelSelectionProjectionState = { lastUsed: null, pending: null }
  for (const event of events) state = applyModelSelectionProjection(state, event)
  return { lastUsed: state.lastUsed, next: state.pending ?? state.lastUsed }
}
