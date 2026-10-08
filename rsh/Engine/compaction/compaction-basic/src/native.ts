/**
 * Native compaction Provider: automatic step-boundary pressure compaction
 * through each active Session owner's pre-step admission, and explicit idle
 * compaction for `/compact`, over the same range selection, summarization and
 * durable bracket as the Cordis backend.
 *
 * @module @deepseek-ai/dsh-compaction-basic/native
 */

import { ManualCompactionError } from '@deepseek-ai/dsh-compaction/native'
import type {
  CompactionResult, CompactionTrigger, NativeCompactionOperations, NativeCompactionOwner,
} from '@deepseek-ai/dsh-compaction/native'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeModel } from '@deepseek-ai/dsh-native-model-execution'
import type { NativeModelExecution, NativeModelRecoveryRequest } from '@deepseek-ai/dsh-native-model-execution'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm/native'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type {
  NativeActiveSessionOperations, NativeActiveSessionOwner, NativeStepAdmissionHook,
} from '@deepseek-ai/dsh-native-session-execution'
import type { NativeTokenMeterOperations } from '@deepseek-ai/dsh-token-meter/native'
import type { NativeToolResultPrunerOperations } from '@deepseek-ai/dsh-compaction-tool-result-pruner/native'
import { resolveConfig, resolveTargetPolicy } from './config.ts'
import {
  compactForStepPressure, compactForTrigger, compactIdleSurface, compactTurnRegion, routedTarget, summarizeConversation,
} from './policy.ts'
import type { RegionDependencies } from './region.ts'
import type { BasicCompactionConfig, ResolvedConfig } from './types.ts'

export type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy,
} from './types.ts'

/** Default ascending pre-step admission priority of automatic pressure compaction. */
const DEFAULT_ADMISSION_ORDER = 100

/** Native installation config: the shared backend policy plus the admission priority. */
export interface NativeBasicCompactionConfig extends BasicCompactionConfig {
  /** Finite ascending pre-step admission priority; lower values compact before later hooks. Defaults to `100`. */
  admissionOrder?: number
}

/** Validated native configuration. */
export interface ResolvedNativeBasicCompactionConfig {
  readonly compaction: ResolvedConfig
  readonly admissionOrder: number
}

/**
 * Validate native compaction configuration.
 * @param input - raw installation config.
 * @returns the resolved backend policy and admission priority.
 * @throws when the input is not a plain object, a key is unknown, or a value is invalid.
 */
export function resolveNativeBasicCompactionConfig(input: unknown): ResolvedNativeBasicCompactionConfig {
  if (input === undefined) return { compaction: resolveConfig(), admissionOrder: DEFAULT_ADMISSION_ORDER }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('compaction-basic: native configuration must be an object')
  }
  const { admissionOrder = DEFAULT_ADMISSION_ORDER, ...policy } = input as NativeBasicCompactionConfig
  if (typeof admissionOrder !== 'number' || !Number.isFinite(admissionOrder)) {
    throw new Error('BasicCompactionConfig: admissionOrder must be a finite number')
  }
  return { compaction: resolveConfig(policy), admissionOrder }
}

/** Native services the Provider reads. */
export interface NativeBasicCompactionServices {
  readonly model: NativeModel
  readonly modelExecution?: NativeModelExecution | undefined
  readonly tokenMeter: NativeTokenMeterOperations
  readonly activeSessions: NativeActiveSessionOperations
  readonly toolResultPruner?: NativeToolResultPrunerOperations | undefined
}

/**
 * Native compaction Provider. It never opens turns or Session writers: every
 * append goes through the supplied owner, and automatic compaction runs only
 * inside the Program's own pre-step admission.
 */
export class NativeBasicCompaction implements NativeCompactionOperations {
  private readonly warnedPressureConfigTargets = new Set<string>()
  private readonly hooks = new Map<NativeActiveSessionOwner, () => Promise<void>>()
  private readonly overflowRetries = new WeakMap<Session, { turn: number; step: number; retries: number }>()

  /**
   * @param services - selected model, token meter, active owners and optional pruner.
   * @param config - resolved backend policy and admission priority.
   */
  constructor(
    private readonly services: NativeBasicCompactionServices,
    private readonly config: ResolvedNativeBasicCompactionConfig,
  ) {}

  /**
   * Register automatic pressure compaction on every current and future active owner.
   * @returns removal of lifecycle observers after accepted callbacks and hooks drain.
   */
  attach(): () => Promise<void> {
    const { activeSessions } = this.services
    const recoveryLifetime = new AbortController()
    const recoveries = new Set<Promise<unknown>>()
    let closing = false
    const installHook = (owner: NativeActiveSessionOwner): void => {
      if (this.hooks.has(owner)) return
      this.hooks.set(owner, owner.beforeStep(this.admission(owner), this.config.admissionOrder))
    }
    const releases = [
      activeSessions.onAttached(async (owner) => { installHook(owner) }),
      activeSessions.onDetached(async (owner) => {
        const release = this.hooks.get(owner)
        await release?.()
        if (this.hooks.get(owner) === release) this.hooks.delete(owner)
      }),
    ]
    for (const owner of activeSessions.owners()) installHook(owner)
    const removeRecovery = this.config.compaction.auto ? this.services.modelExecution?.onRecovery(async (request, next) => {
      if (closing) return undefined
      if (request.signal.aborted || request.failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE) return next()
      const owner = activeSessions.owners().find(candidate => candidate.session === request.session)
      const target = routedTarget(request.session)
      if (owner === undefined || target === undefined) return undefined
      const state = this.overflowRetries.get(request.session)
      const retries = state?.turn === request.turn && state.step === request.step ? state.retries : 0
      const policy = resolveTargetPolicy(this.config.compaction, target)
      if (retries >= policy.maxOverflowRetries) return undefined

      const generation = request.session.surface.replaceGeneration
      const signal = AbortSignal.any([request.signal, recoveryLifetime.signal])
      const operation = this.recoverOverflow(request, owner, retries, generation, signal)
      const tracked = operation.finally(() => recoveries.delete(tracked))
      recoveries.add(tracked)
      return tracked
    }) : undefined
    return async () => {
      closing = true
      recoveryLifetime.abort(new Error('compaction-basic: native Provider disposed'))
      removeRecovery?.()
      const observers = await Promise.allSettled(releases.map(async (release) => { await release() }))
      const hooks = await Promise.allSettled([...this.hooks.values()].map(async (release) => { await release() }))
      const recoveryResults = await Promise.allSettled([...recoveries])
      this.hooks.clear()
      const failures = [...observers, ...hooks, ...recoveryResults]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length > 0) {
        throw new AggregateError(failures.map(failure => failure.reason as unknown), 'compaction-basic: hook cleanup failed')
      }
    }
  }

  private async recoverOverflow(
    request: NativeModelRecoveryRequest,
    owner: NativeActiveSessionOwner,
    retries: number,
    generation: number,
    signal: AbortSignal,
  ): Promise<{ readonly kind: 'retry' } | undefined> {
    try {
      const result = await this.compactIfNeeded(owner, 'context-overflow', signal)
      signal.throwIfAborted()
      if (request.session.surface.replaceGeneration <= generation) return undefined
      this.overflowRetries.set(request.session, { turn: request.turn, step: request.step, retries: retries + 1 })
      if (result !== null) {
        console.info(`compaction (context overflow recovery): shadowed ${result.shadowedSeqs.length} surface nodes `
          + `(seqs ${result.shadowedRange.start}-${result.shadowedRange.end}, ~${result.shadowedTokenCount} tokens)`)
      }
      return { kind: 'retry' }
    } catch (error: unknown) {
      if (signal.aborted) return undefined
      if (request.session.surface.replaceGeneration > generation) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`compaction-basic: context-overflow compaction failed after durable surface progress: ${message}; retrying from the replacement surface`)
        this.overflowRetries.set(request.session, { turn: request.turn, step: request.step, retries: retries + 1 })
        return { kind: 'retry' }
      }
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`compaction-basic: context-overflow compaction failed: ${message}; preserving the original request error`)
      return undefined
    }
  }

  /** @inheritdoc */
  async compactIfNeeded(owner: NativeCompactionOwner, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> {
    const { model, tokenMeter, toolResultPruner } = this.services
    return compactForTrigger(this.config.compaction, {
      session: owner.session,
      meter: tokenMeter,
      prune: toolResultPruner === undefined ? undefined : () => { toolResultPruner.pruneSession(owner) },
      contextWindow: async (target, abort) => {
        if (model.resolveModel !== undefined) {
          return (await model.resolveModel(target.provider, target.model, abort)).context?.contextWindow
        }
        const recorded = owner.session.requestContext()
        return recorded?.provider === target.provider && recorded.model === target.model ? recorded.contextWindow : undefined
      },
      compactRegion: (start, end, abort) => compactTurnRegion(this.regionDependencies(), owner, start, end, owner, abort),
    }, trigger, signal)
  }

  /** @inheritdoc */
  async compactNow(owner: NativeCompactionOwner, signal: AbortSignal, sourceCommandId?: CommandId): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    if (!owner.writerAvailable) {
      throw new ManualCompactionError('busy', 'manual compaction requires the live Session writer')
    }
    return compactIdleSurface(this.regionDependencies(), owner, owner, () => owner.flush(), signal, sourceCommandId)
  }

  /** Compact before the remaining admission chain; failures warn once per target and never block the step. */
  private admission(owner: NativeActiveSessionOwner): NativeStepAdmissionHook {
    return async (context, next) => {
      await compactForStepPressure(
        () => this.compactIfNeeded(owner, 'pressure', context.signal),
        context.signal,
        this.warnedPressureConfigTargets,
        (message) => { console.warn(`compaction-basic: ${message}`) },
      )
      return await next()
    }
  }

  /** Bind the selected meter and model stream for one transaction. */
  private regionDependencies(): RegionDependencies<NativeCompactionOwner> {
    const { model, tokenMeter } = this.services
    return {
      meter: tokenMeter,
      summarize: (input, owner, signal) =>
        summarizeConversation(this.config.compaction, options => model.stream(options), input, { session: owner.session }, signal),
    }
  }
}

/** Install the native compaction Provider over the selected model and token meter. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-compaction-basic', targets: ['host'],
  requires: ['model', 'tokenMeter', 'activeSessions'], optional: ['modelExecution', 'toolResultPruner'], provides: ['compaction'],
  resolve(input) {
    const config = resolveNativeBasicCompactionConfig(input)
    return (context) => {
      const engine = new NativeBasicCompaction({
        model: context.require('model'),
        modelExecution: context.optional('modelExecution'),
        tokenMeter: context.require('tokenMeter'),
        activeSessions: context.require('activeSessions'),
        toolResultPruner: context.optional('toolResultPruner'),
      }, config)
      if (config.compaction.auto) context.effect(engine.attach())
      context.provide('compaction', engine)
    }
  },
}
