/**
 * Ordered tool interception points: the per-call decisions a policy makes before a
 * tool body runs and after its result exists.
 *
 * The pre point answers allow, deny or ask and may rewrite the arguments the body
 * receives. The post point answers pass or block with corrective feedback and may
 * attach model context. Both are waterfalls in the sense the rest of this registry
 * uses: a listener either delegates with `next` or answers on its own.
 *
 * @module @redspark/rsh-native-tools/tool-interception
 */

import type { ContentBlock, ToolCallId, UserMessage } from '@redspark/rsh-llm/native'
import { deepFreeze, snapshotJsonValue, type JsonValue } from '@redspark/rsh-util-values'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type {
  Session, SessionEvent, SessionEventMap, SessionEventType, SurfaceEventType, SurfaceIntent,
} from '@redspark/rsh-session/native'
import type { NativeToolExecution, NativeToolResult } from './index.ts'

/** Facts one pre-tool decision sees before the tool body runs. */
export interface NativeToolPreCall {
  /** Exact live Agent whose scope selected the interceptor. */
  readonly agent: NativeAgent
  readonly session: Session
  readonly callId: ToolCallId
  readonly name: string
  /** Parsed arguments the body would receive; a decision may replace the object value. */
  readonly arguments: unknown
  /** Open turn the call belongs to; absent for calls outside a recorded turn. */
  readonly turn?: number
  /** Registry, policy and caller cancellation. */
  readonly signal: AbortSignal
  /**
   * Append and persist one event through the application's single tracked writer.
   *
   * A policy that records its own audit facts must use this rather than the Session
   * directly: the application keeps one contiguous pending batch, and an append that
   * bypasses it desynchronizes the next write.
   */
  readonly appendEvent?: <T extends SessionEventType>(
    type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []
  ) => Promise<SessionEvent<T>>
}

/**
 * Answer for one pre-tool interception point.
 *
 * `allow` runs the body; `deny` records an error result carrying `reason`;
 * `ask` runs only after the consuming application authorizes the call and otherwise
 * records the same shape of error. `arguments` replaces the parsed arguments the body
 * receives and never rewrites the arguments already recorded on `tool/call`.
 */
export type NativeToolPreDecision =
  | { readonly kind: 'allow'; readonly arguments?: unknown }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'ask'; readonly reason?: string }

/** Facts one post-tool decision sees after the body produced a result. */
export interface NativeToolPostCall {
  readonly agent: NativeAgent
  readonly session: Session
  readonly callId: ToolCallId
  readonly name: string
  /** Parsed arguments the body ran with, including any pre-tool rewrite. */
  readonly arguments: unknown
  readonly turn?: number
  readonly signal: AbortSignal
  /** Immutable body result before any post-tool decision transforms it. */
  readonly result: Readonly<NativeToolResult>
  /** Append and persist one event through the application's single tracked writer. */
  readonly appendEvent?: NativeToolPreCall['appendEvent']
}

/**
 * Answer for one post-tool interception point.
 *
 * `pass` keeps the result; `block` turns the call into a failure whose model-visible
 * content is `feedback`. Either answer may attach `additionalContexts`, which the
 * application appends after the recorded result like any other tool context.
 */
export type NativeToolPostDecision =
  | { readonly kind: 'pass'; readonly additionalContexts?: readonly UserMessage[] }
  | { readonly kind: 'block'; readonly feedback: readonly ContentBlock[]; readonly additionalContexts?: readonly UserMessage[] }

/**
 * Answer the pre-tool point for one call.
 * @param call - frozen call facts and cancellation.
 * @param next - delegate exactly once; returning without it stops the chain with this answer.
 * @returns to allow, deny or request approval for the body.
 */
export type NativeToolPreInterceptor = (
  call: Readonly<NativeToolPreCall>, next: () => Promise<NativeToolPreDecision>,
) => Promise<NativeToolPreDecision>

/**
 * Answer the post-tool point for one recorded body result.
 * @param call - frozen call facts with the immutable body result.
 * @param next - delegate exactly once; returning without it stops the chain with this answer.
 * @returns to keep or block the result before the application records it.
 */
export type NativeToolPostInterceptor = (
  call: Readonly<NativeToolPostCall>, next: () => Promise<NativeToolPostDecision>,
) => Promise<NativeToolPostDecision>

/** The facts one pre-tool decision sees, derived from an invocation before argument validation. */
export interface NativeToolPreCallInput {
  /** Live Agent whose scope selects the interceptors. */
  readonly agent: NativeToolExecution['agent']
  readonly session: Session
  readonly callId: ToolCallId
  readonly name: string
  /** Parsed arguments before any rewrite; the pre point never sees unvalidated JSON. */
  readonly arguments: unknown
  readonly turn?: number
  /** Cancellation already combined with the invocation's own. */
  readonly signal: AbortSignal
}

/** Whether a decision replaces the parsed arguments the body receives. */
export function replacesArguments(decision: NativeToolPreDecision): decision is Extract<NativeToolPreDecision, { kind: 'allow' }> & { arguments: unknown } {
  return decision.kind === 'allow' && 'arguments' in decision && decision.arguments !== undefined
}

/**
 * Detach one replacement argument value for the body.
 * @param name - tool name used in the diagnostic.
 * @param candidate - value supplied by an interceptor.
 * @returns the frozen lossless JSON the body receives.
 * @throws When the value is not lossless JSON.
 */
export function admittedArguments(name: string, candidate: unknown): JsonValue {
  const detached = snapshotJsonValue(candidate)
  if (detached === undefined) {
    throw new Error(`native-tools: interceptor supplied non-lossless JSON arguments for "${name}"`)
  }
  return deepFreeze(detached as JsonValue)
}
