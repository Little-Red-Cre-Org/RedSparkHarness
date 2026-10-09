/** Continuable Session execution supplied by the selected Program owner. */
import type { NativeAgent, InboxTarget } from '@deepseek-ai/dsh-native-agent'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionConfiguration, NativeSessionDelegation, NativeSessionTurnResult } from './index.ts'
import type { NativeActiveSessionOwner } from './active-session.ts'

/** Existing durable state read without acquiring a second mutable Session owner. */
export interface NativeContinuationObservation {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount: number
  readonly defaults: NativeSessionConfiguration
}

/** One catalog candidate read; independent writer cleanup failures still reject the operation. */
export type NativeContinuationInspection =
  | { readonly kind: 'child'; readonly observation: NativeContinuationObservation }
  | { readonly kind: 'diagnostic'; readonly id: SessionId; readonly reason: 'corrupt' | 'unsupported' | 'unavailable' }

/** Read-only catalog position; listing grants no message delivery or interruption permission. */
export interface NativeContinuationCandidate {
  readonly path: readonly [SessionId, ...SessionId[]]
  readonly status: 'running' | 'idle' | 'ready'
}

/** Fresh or cold child residency with declared composition and no independent turn loop. */
export interface NativeContinuationRequest extends Omit<NativeSessionDelegation, 'lifetime' | 'message' | 'onReady'> {
  readonly resume: boolean
  /** Notify after release with the durable child observation for this residency epoch.
   * @param result - completed Program turn result, if a turn ran.
   * @param failure - execution or cleanup failure, if one occurred.
   * @param observation - exact durable child history after writer release.
   * @returns completion of any consumer settlement work.
   */
  readonly onSettled?: (result: NativeSessionTurnResult | undefined, failure: unknown,
    observation: NativeContinuationObservation | undefined) => Promise<void>
}

/** One Program-owned residency epoch of a durable child Session. */
export interface NativeSessionContinuation {
  readonly id: SessionId
  readonly agent: NativeAgent
  /** True once this residency closes admission; cold reactivation waits for done. */
  readonly isClosing: boolean
  /** Resolves after first turn setup and descriptor publication, independently of model completion. */
  readonly ready: Promise<void>
  /**
   * Wait for the first foreground turn and foreground descendants to settle; background work may remain.
   * @returns completion when this child's foreground work settles.
   */
  waitForeground(): Promise<void>
  /** Resolves after writer and Agent release and any settlement notification admission. */
  readonly done: Promise<void>
  /**
   * Accept input through this child's sole durable inbox.
   * @param message - validated identified input.
   * @param target - next-turn queue or next-step steering.
   * @param signal - admission cancellation, detached after accepted durability.
   * @returns accepted message id, independently of its eventual execution.
   */
  enqueue(message: UserMessage, target: InboxTarget, signal: AbortSignal): Promise<MessageId>
  /** Request interruption while preserving unclaimed input; the current turn settles asynchronously.
   * @param reason - driver cancellation cause.
   */
  interrupt(reason: unknown): void
  /** Retain residency while an owned descendant has work. @returns exact idempotent ownership release. */
  retainChild(): () => void
  /** Close admission, cancel and drain accepted work and release the only writer. @returns quiescent release. */
  dispose(): Promise<void>
}

/** Selected Program operations authorized by the exact initiating Agent and active Session. */
export interface NativeSessionContinuations {
  /** Whether this Program has closed admission for new continuation operations. */
  readonly isClosing: boolean
  /**
   * Materialize a child under the selected parent without transferring execution ownership.
   * @param request - exact durable child id, create/resume choice and resolved composition.
   * @param signal - startup cancellation, detached after materialization.
   * @returns one resident child handle without starting a second loop.
   */
  open(request: NativeContinuationRequest, signal: AbortSignal): Promise<NativeSessionContinuation>
  /** Maintain the exact resident child without changing its delegated invocation or synthesizing a turn.
   * @param id - direct child already materialized by these parent-bound operations.
   * @param operation - callback using the Program's sole delegated owner.
   * @param signal - admission cancellation, composed with parent and child lifetimes.
   * @returns callback result after persistence; accepted descendant work may continue.
   */
  maintenance<T>(id: SessionId, operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal): Promise<T>
  /**
   * Read a direct child's durable state for cold reconstruction.
   * @param id - durable direct-child identity.
   * @param signal - read cancellation.
   * @returns validated header, accepted events and deployment defaults.
   */
  observe(id: SessionId, signal: AbortSignal): Promise<NativeContinuationObservation>
  /**
   * Enumerate subagent candidates through the selected durable corpus, including ordinary traversal nodes.
   * @param scope - direct children or stable pre-order descendants.
   * @param signal - listing cancellation.
   * @returns authorized lineage paths and actual Program residency observations; no Agent is loaded.
   */
  catalog(scope: 'children' | 'descendants', signal: AbortSignal): Promise<readonly NativeContinuationCandidate[]>
  /**
   * Read one descendant along an explicit lineage authorized by its initiating parent.
   * @param path - durable direct-parent identities through ordinary or subagent intermediaries to a subagent candidate.
   * @param signal - validation and read cancellation.
   * @returns validated candidate or its per-item durable read diagnostic.
   */
  inspect(path: readonly [SessionId, ...SessionId[]], signal: AbortSignal): Promise<NativeContinuationInspection>
  /**
   * Deliver adjacent-Agent input or a runtime notice through the target's sole durable inbox.
   * @param id - live direct parent or direct-child identity.
   * @param message - validated identified message with durable attribution.
   * @param target - next-turn queue or next-step steering.
   * @param wake - whether admitted input should wake an idle target.
   * @param signal - cancellation before durable admission.
   * @returns durable accepted input identity.
   */
  deliver(id: SessionId, message: UserMessage, target: InboxTarget, wake: boolean, signal: AbortSignal): Promise<MessageId>
}
