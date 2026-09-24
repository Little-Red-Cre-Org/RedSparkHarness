/** Native approval identifiers, closed outcomes, and Session audit event data. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'

/** Opaque identifier pairing one native approval request with its decision audit. */
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

/** Closed one-shot outcomes; all values except allowed-once fail the requested action. */
export type NativeApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Deployment policy before the selected answerers receive a request. */
export type NativeApprovalPolicy = 'ask' | 'never'

/** Complete decision that the consuming application records exactly once. */
export interface NativeApprovalDecision {
  /** Identifier pairing the decision with the corresponding asked audit event. */
  readonly id: NativeApprovalRequestId
  /** Policy used to reach the decision. */
  readonly policy: NativeApprovalPolicy
  /** Closed outcome selected by policy or an answerer. */
  readonly outcome: NativeApprovalOutcome
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One native approval question before a matching decision is recorded. */
    'native-approval/asked': {
      id: NativeApprovalRequestId
      toolName: string
      callId?: ToolCallId
      reason?: string
    }
    /** Closed native approval outcome paired with a preceding native-approval/asked event. */
    'native-approval/decided': {
      id: NativeApprovalRequestId
      policy: NativeApprovalPolicy
      outcome: NativeApprovalOutcome
    }
  }
}
