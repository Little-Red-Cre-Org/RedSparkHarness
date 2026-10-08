/**
 * Framework-free provider-routed retry decisions shared by the Cordis and native recovery installers.
 * @module @deepseek-ai/dsh-llm-retry/core
 */
import { randomUUID } from 'node:crypto'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm/native'
import { RetryId } from './brand.ts'
import type { LlmRetryEventData, LlmRetryStartedEventData } from './types.ts'

/**
 * Reject executor configuration; providers own `retryPolicy`, so any key is a misplaced setting.
 * @param config - installation configuration from either runtime.
 */
export function assertEmptyRetryConfig(config: unknown): void {
  if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) {
    throw new Error('llm-retry: configuration must be an object')
  }
  const [key] = Object.keys(config ?? {})
  if (key === undefined) return
  if (key === 'retryPolicy') throw new Error('llm-retry: retryPolicy belongs under each provider configuration')
  throw new Error(`llm-retry: unknown key "${key}"`)
}

/** Non-serializable hooks used to make timing policy deterministic in tests. */
export interface RetryInternals {
  /** Random sample in the inclusive zero-to-one range used for jitter. */
  random?: () => number
}

/** Retry decision shared by both runtimes; `undefined` keeps the failure. */
export type RetryAction = { readonly kind: 'retry' } | undefined

/** Last scheduled retry of one provider and policy within the current step. */
export interface RetryStateEntry {
  retry: number
  retryId: RetryId
}

/** Failed request facts offered by the owning runtime. */
export interface RetryRequest {
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly failure: LlmFailure
  /** Provider-owned policy captured with the request route; absent declines retry. */
  readonly retryPolicy?: ResolvedRetryPolicy | undefined
  readonly signal: AbortSignal
}

/** Runtime-owned state, durable recording and diagnostics for one recovery attempt. */
export interface RetryHost {
  /** Installer lifetime; abort prevents new schedules and ends active waits. */
  readonly lifetime: AbortSignal
  readonly random: () => number
  /** @param key - provider and policy identity from {@link retryStateKey}. @returns the step's previous retry. */
  previous(key: string): RetryStateEntry | undefined
  /** Record the scheduled retry before its cancellable wait. @param data - durable payload. */
  scheduled(data: LlmRetryEventData): void | Promise<void>
  /** Record the completed wait before the next attempt. @param data - durable payload. */
  started(data: LlmRetryStartedEventData): void | Promise<void>
  /** Report an ignored downstream failure under unbounded retry. @param message - context. @param error - failure. */
  warn(message: string, error: unknown): void
}

type DownstreamOutcome =
  | { readonly type: 'decision'; readonly decision: RetryAction }
  | { readonly type: 'error'; readonly error: unknown }

async function settleDownstream(next: () => Promise<RetryAction>): Promise<DownstreamOutcome> {
  try {
    return { type: 'decision', decision: await next() }
  } catch (error: unknown) {
    return { type: 'error', error }
  }
}

/**
 * Compute one jittered exponential local delay.
 * @param config - provider-owned resolved policy.
 * @param retry - one-based retry number.
 * @param random - jitter sample source.
 * @returns delay in milliseconds, capped at the policy maximum.
 */
export function localDelay(config: ResolvedRetryPolicy, retry: number, random: () => number): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(config.initialDelayMs * 2 ** exponent, config.maxDelayMs)
  const jitter = 1 - config.jitterRatio + 2 * config.jitterRatio * random()
  return Math.min(exponential * jitter, config.maxDelayMs)
}

/**
 * Identify a resolved policy so a changed policy starts a new retry chain.
 * @param policy - provider-owned resolved policy.
 * @returns stable JSON identity of every field that affects scheduling.
 */
export function retryPolicyKey(policy: ResolvedRetryPolicy): string {
  return policy.mode === 'always'
    ? JSON.stringify([policy.mode, policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio])
    : JSON.stringify([
      policy.mode,
      policy.maxRetries,
      [...policy.retryableCodes].sort(),
      policy.initialDelayMs,
      policy.maxDelayMs,
      policy.jitterRatio,
    ])
}

/**
 * Key one provider's chain under one policy.
 * @param provider - failed provider route.
 * @param policyKey - result of {@link retryPolicyKey}.
 * @returns the state key.
 */
export function retryStateKey(provider: string, policyKey: string): string {
  return JSON.stringify([provider, policyKey])
}

function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Apply provider-routed normal or unbounded retry to one failed request attempt.
 * @param host - runtime-owned state, recording and lifetime.
 * @param request - failed attempt facts and caller cancellation.
 * @param next - remaining recovery policies; normal mode delegates non-retryable failures, always mode delegates first.
 * @returns a retry after the durable schedule and completed wait, or the delegated/abandoned decision.
 */
export async function recoverWithRetry(
  host: RetryHost, request: RetryRequest, next: () => Promise<RetryAction>,
): Promise<RetryAction> {
  const { turn, step, provider, failure, retryPolicy: policy, signal } = request
  if (policy === undefined) return next()
  if (policy.mode === 'always') {
    if (signal.aborted || host.lifetime.aborted) return
    const fusedSignal = AbortSignal.any([signal, host.lifetime])
    // The loop and installer lifetime stay open until delegated recovery settles.
    // An abort then wins before the decision or fallback can mutate later state.
    const downstream = await settleDownstream(next)
    if (fusedSignal.aborted) return
    if (downstream.type === 'error') {
      host.warn(`llm-retry: provider "${provider}" always policy ignored a downstream recovery failure`, downstream.error)
    }
    if (downstream.type === 'decision' && downstream.decision?.kind === 'retry') {
      return downstream.decision
    }
  } else if (!policy.retryableCodes.includes(failure.code)) {
    return next()
  }

  const policyKey = retryPolicyKey(policy)
  const previous = host.previous(retryStateKey(provider, policyKey))
  const previousRetry = previous?.retry ?? 0
  if (policy.mode === 'normal' && previousRetry >= policy.maxRetries) return next()
  const retry = previousRetry + 1
  const retryId = previous?.retryId ?? RetryId(randomUUID())
  let delayMs: number
  if (failure.providerRetryAfterMs !== undefined
    && Number.isFinite(failure.providerRetryAfterMs)
    && failure.providerRetryAfterMs > 0) {
    if (failure.providerRetryAfterMs > policy.maxDelayMs) {
      if (policy.mode === 'normal') return next()
      delayMs = localDelay(policy, retry, host.random)
    } else {
      delayMs = failure.providerRetryAfterMs
    }
  } else {
    delayMs = localDelay(policy, retry, host.random)
  }

  const fusedSignal = AbortSignal.any([signal, host.lifetime])
  if (fusedSignal.aborted) return
  const eventData: LlmRetryEventData = policy.mode === 'normal'
    ? { retryId, turn, step, provider, mode: policy.mode, policyKey, retry, maxRetries: policy.maxRetries, delayMs, failure }
    : { retryId, turn, step, provider, mode: policy.mode, policyKey, retry, delayMs, failure }
  await host.scheduled(eventData)
  if (!await cancellableDelay(delayMs, fusedSignal)) return
  await host.started({ retryId, turn, step, retry })
  return { kind: 'retry' }
}
