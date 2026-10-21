/** Framework-free native approval identities and consumer operations. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/native'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-session/types'

/** Deployment policy applied before native answerers receive a request. */
export type NativeApprovalPolicy = 'ask' | 'never'

/** Read the latest durable approval override from the Session that owns an invocation.
 * @param session - the existing Session whose log is the policy authority.
 * @returns its latest compatibility approval override, or `undefined` when none was recorded.
 */
export function sessionApprovalPolicy(session: Session): NativeApprovalPolicy | undefined {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Keep the pure durable fold until Session exposes its public event iterator.
    const event = session.eventAt(SessionSeq(seq))
    if (event?.type === 'approval/policy') return event.data.policy
  }
  return undefined
}

/** Opaque native approval identity pairing its durable asked and decided events. */
export type NativeApprovalRequestId = Branded<'NativeApprovalRequestId'>

/**
 * Brand a nonempty native approval request identifier.
 * @param value - raw identifier received at an application or persistence boundary.
 * @returns the opaque native approval request identifier.
 */
export function NativeApprovalRequestId(value: string): NativeApprovalRequestId {
  if (value.length === 0) throw new Error('native-approval: request id must be nonempty')
  return brandString<NativeApprovalRequestId>(value)
}

/** Closed outcomes returned by a native approval answerer. */
export type NativeApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Complete native decision that the consuming application records exactly once. */
export interface NativeApprovalDecision {
  /** Identifier pairing the decision with the corresponding asked audit event. */
  readonly id: NativeApprovalRequestId
  /** Deployment policy used before answerer dispatch. */
  readonly policy: NativeApprovalPolicy
  /** Closed answer selected by policy or an answerer. */
  readonly outcome: NativeApprovalOutcome
}

/** One native operation whose caller has already written its asked event. */
export interface NativeApprovalRequest {
  /** Fresh identity already written to `native-approval/asked`. */
  readonly id: NativeApprovalRequestId
  /** Registered Agent that owns the requested operation. */
  readonly agent: NativeAgent
  /** Effective durable Session override resolved by its owning Program before dispatch. */
  readonly sessionPolicy?: NativeApprovalPolicy
  /** Model-visible tool name about to execute. */
  readonly toolName: string
  /** Model tool-call identity when available. */
  readonly callId?: ToolCallId
  /** User-facing reason supplied by the contribution or application. */
  readonly reason?: string
  /** Cancels the unanswered request and prevents a late answer from applying. */
  readonly signal?: AbortSignal
}

/** Immutable native request given to one answerer. */
export interface NativeApprovalAnswererRequest extends NativeApprovalRequest {
  /** Effective policy selected before answerer dispatch. */
  readonly policy: NativeApprovalPolicy
  /** Aborted by the caller or Provider disposal; answerers must stop owned work. */
  readonly signal: AbortSignal
}

/** One native answerer claims a request with an outcome or returns undefined to delegate. */
export type NativeApprovalAnswerer = (request: NativeApprovalAnswererRequest) =>
  NativeApprovalOutcome | undefined | Promise<NativeApprovalOutcome | undefined>

/** Native service operations consumed by an application or tool registry. */
export interface NativeApprovalServiceDefinition {
  readonly policy: NativeApprovalPolicy
  /** @param answerer - deployment-owned decision callback. @returns idempotent removal of that answerer. */
  registerAnswerer(answerer: NativeApprovalAnswerer): () => void
  /** @param request - live Agent, operation and identity already recorded by its Session owner. @returns the closed decision. */
  request(request: NativeApprovalRequest): Promise<NativeApprovalDecision>
  /** @returns completion after active decisions and answerer work have settled. */
  dispose(): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { approval: NativeApprovalServiceDefinition }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable per-Session approval override shared by Native and compatibility consumers. */
    'approval/policy': { policy: NativeApprovalPolicy; source?: 'delegation' }
  }
  interface SessionEventMap {
    /** One native approval question before its matching decision is recorded. */
    'native-approval/asked': {
      id: NativeApprovalRequestId
      toolName: string
      callId?: ToolCallId
      reason?: string
    }
    /** Closed native approval outcome paired with a preceding native asked event. */
    'native-approval/decided': {
      id: NativeApprovalRequestId
      policy: NativeApprovalPolicy
      outcome: NativeApprovalOutcome
    }
  }
}
