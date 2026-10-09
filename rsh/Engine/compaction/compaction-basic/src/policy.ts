/**
 * Runtime-neutral automatic compaction policy shared by the Cordis and native
 * Providers: routed-target resolution, pressure thresholds, the optional
 * model-free prune pass, bounded summary attempts and overflow reduction.
 *
 * @module @deepseek-ai/dsh-compaction-basic/policy
 */

import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction/native'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session/native'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { resolveCompactSpec, resolveTargetPolicy, TargetPressureConfigError } from './config.ts'
import { assertNoActiveCompaction, compactSurfaceRegion, selectCompactableRange } from './region.ts'
import type { RegionDependencies, RegionMeter, RegionTarget } from './region.ts'
import { summarizeWithLlm } from './summarizer.ts'
import type { SummarizationInput, SummaryResult, SummaryRoute, SummaryStream } from './summarizer.ts'
import type { ResolvedConfig } from './types.ts'

/** Exact provider/model pair durably routed for one request. */
export type RoutedTarget = Pick<LlmCallConfig, 'provider' | 'model'>

/**
 * Resolve the exact provider/model durably routed for the latest request.
 * @param session - Session whose request header is read.
 * @returns the routed target, or `undefined` before any complete routed request.
 */
export function routedTarget(session: Session): RoutedTarget | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) {
    return undefined
  }
  return { provider: config.provider, model: config.model }
}

/** Runtime operations one automatic compaction decision uses. */
export interface TriggerCompaction {
  readonly session: Session
  readonly meter: RegionMeter
  /** Land the optional model-free tool-result pass; absent when no pruner is selected. */
  readonly prune?: (() => void) | undefined
  /**
   * Resolve the routed model's context capacity.
   * @param target - exact routed provider/model.
   * @param signal - turn cancellation.
   * @returns the context window in tokens, or `undefined` when unknown.
   */
  contextWindow(target: RoutedTarget, signal: AbortSignal): Promise<number | undefined>
  /**
   * Compact one balanced inclusive surface range inside the open turn.
   * @param start - inclusive first surface-node seq.
   * @param end - inclusive last surface-node seq.
   * @param signal - turn cancellation forwarded to summarization.
   * @returns the committed compaction result.
   */
  compactRegion(start: SessionSeq, end: SessionSeq, signal: AbortSignal): Promise<CompactionResult>
}

/**
 * Compact for replayed step-boundary pressure or one provider-confirmed context
 * overflow. Both triggers price the latest durable routed request envelope;
 * overflow bypasses the normal threshold and retained-tail policy so it can
 * force one useful balanced reduction.
 * @param config - resolved backend configuration.
 * @param run - runtime operations for this Session.
 * @param trigger - normal step-boundary pressure or context-overflow recovery.
 * @param signal - live turn cancellation forwarded to summarization.
 * @returns the latest summary compaction result, or `null` when no summary ran.
 * @throws {@link TargetPressureConfigError} when pressure qualifies for a target
 * without known context capacity; an `Error` when bounded attempts still leave
 * pressure above threshold.
 */
export async function compactForTrigger(
  config: ResolvedConfig,
  run: TriggerCompaction,
  trigger: CompactionTrigger,
  signal: AbortSignal,
): Promise<CompactionResult | null> {
  const { session, meter } = run
  const target = routedTarget(session)
  if (target === undefined) return null
  const policy = resolveTargetPolicy(config, target)
  let measurement = meter.measure(session)
  switch (trigger) {
    case 'context-overflow':
      break
    case 'pressure':
      break
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      assertNever(trigger, 'compaction trigger')
  }

  // Pruning is optional so compaction-basic remains independently composable.
  // Overflow always qualifies; pressure first resolves the routed model's
  // capacity and checks its target-specific threshold.
  if (trigger === 'context-overflow') {
    if (run.prune !== undefined) {
      run.prune()
      measurement = meter.measure(session)
    }
    const range = selectCompactableRange(session, measurement, 0)
    if (range === null) return null
    return run.compactRegion(range.start, range.end, signal)
  }

  const contextWindow = await run.contextWindow(target, signal)
  assertNoActiveCompaction(session, 'automatic pressure compaction')
  const targetKey = `${target.provider}/${target.model}`
  if (contextWindow === undefined) {
    throw new TargetPressureConfigError(
      targetKey,
      `compaction-basic: no context capacity for ${targetKey}; `
      + 'configure contextWindow on that adapter model',
    )
  }
  const spec = resolveCompactSpec(policy, contextWindow)
  if (measurement.totalTokens < spec.thresholdTokens) return null

  // Once pressure qualifies, land the model-free pass before choosing a
  // summary range, then remeasure through the singleton replay fold.
  if (run.prune !== undefined) {
    run.prune()
    measurement = meter.measure(session)
  }
  if (measurement.totalTokens < spec.thresholdTokens) return null

  let result: CompactionResult | null = null
  for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
    const range = selectCompactableRange(session, measurement, spec.retainTokens)
    if (range === null) {
      /* v8 ignore else -- concrete replacement preserves a compactable checkpoint; subclass hooks cannot mutate it. */
      if (result === null) return null
      /* v8 ignore next -- paired with the defensive post-success branch above. */
      break
    }
    result = await run.compactRegion(range.start, range.end, signal)
    measurement = meter.measure(session)
    if (measurement.totalTokens < spec.thresholdTokens) return result
  }

  throw new Error(
    `compaction still above threshold after ${spec.compactionRetries + 1} compaction attempts `
    + `(${measurement.totalTokens} estimated tokens >= threshold ${spec.thresholdTokens})`,
  )
}

/**
 * Run step-boundary pressure compaction without letting its failure block the
 * step. A missing-capacity diagnostic is reported once per routed target.
 * @param compact - pressure compaction for the current open turn.
 * @param signal - turn cancellation; an aborted turn skips compaction.
 * @param warnedTargets - targets whose missing-capacity warning was already reported.
 * @param warn - runtime warning sink.
 * @returns the committed result, or `null` when skipped, unnecessary, or failed.
 */
export async function compactForStepPressure(
  compact: () => Promise<CompactionResult | null>,
  signal: AbortSignal,
  warnedTargets: Set<string>,
  warn: (message: string) => void,
): Promise<CompactionResult | null> {
  if (signal.aborted) return null
  try {
    return await compact()
  } catch (error: unknown) {
    if (error instanceof TargetPressureConfigError) {
      if (warnedTargets.has(error.targetKey)) return null
      warnedTargets.add(error.targetKey)
    }
    const message = error instanceof Error ? error.message : String(error)
    warn(`step compaction failed: ${message}; continuing the turn`)
    return null
  }
}

/**
 * Compact one inclusive range inside the open turn that owns the bracket; the
 * whole surface must stay stable while the summary is prepared.
 * @param dependencies - token meter and summarizer bound by the runtime entry.
 * @param target - Session and writer append.
 * @param start - inclusive first surface-node seq.
 * @param end - inclusive last surface-node seq.
 * @param caller - runtime identity passed to the summarizer.
 * @param signal - optional summarization cancellation signal.
 * @returns the successful durable compaction result.
 */
export function compactTurnRegion<TCaller>(
  dependencies: RegionDependencies<TCaller>,
  target: RegionTarget,
  start: SessionSeq,
  end: SessionSeq,
  caller: TCaller,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  return compactSurfaceRegion(dependencies, target, start, end, caller, {
    owner: 'current-turn',
    stability: 'whole-surface',
  }, signal)
}

/**
 * Compact the one useful span an idle Session can shed below the automatic
 * threshold, inside a standalone `turn: null` bracket that is flushed after it
 * closes. The runtime entry owns idle admission around this call.
 * @param dependencies - token meter and summarizer bound by the runtime entry.
 * @param target - Session and writer append.
 * @param caller - runtime identity passed to the summarizer.
 * @param flush - durability barrier for the closed attempt.
 * @param signal - cancellation scoped to this request.
 * @param sourceCommandId - initiating human command, when present.
 * @returns the committed result, or `null` when no safe useful span exists.
 */
export async function compactIdleSurface<TCaller>(
  dependencies: RegionDependencies<TCaller>,
  target: RegionTarget,
  caller: TCaller,
  flush: () => Promise<void>,
  signal: AbortSignal,
  sourceCommandId?: CommandId,
): Promise<CompactionResult | null> {
  const range = selectCompactableRange(target.session, dependencies.meter.measure(target.session), 0)
  if (range === null) return null
  return compactSurfaceRegion(dependencies, target, range.start, range.end, caller, {
    owner: null,
    stability: 'selected-span',
    ...sourceCommandId === undefined ? {} : { sourceCommandId },
    flush,
  }, signal)
}

/**
 * Summarize with the policy override selected by the conversation target: the
 * latest routed request, else the route's fallback target.
 * @param config - resolved backend configuration.
 * @param stream - runtime model stream.
 * @param input - replayed conversation prefix to condense.
 * @param route - Session plus optional fallback target.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe summary blocks and the exact auxiliary call envelope and output.
 */
export function summarizeConversation(
  config: ResolvedConfig,
  stream: SummaryStream,
  input: SummarizationInput,
  route: SummaryRoute,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const target = routedTarget(route.session) ?? route.fallback
  const effective = target === undefined ? config : resolveTargetPolicy(config, target)
  return summarizeWithLlm(stream, effective, input, route, signal)
}
