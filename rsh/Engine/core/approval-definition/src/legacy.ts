/** Framework-free legacy approval contracts and durable policy projection. */
import { type Branded } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { SessionSeq } from '@deepseek-ai/dsh-session/native'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-session/types'

/** One-shot outcome returned by the compatibility answerer chain. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Per-Session policy accepted by compatibility approval consumers. */
export type ApprovalPolicy = 'ask' | 'never'

/** Every supported compatibility approval policy. */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never']

/** Opaque identity pairing one compatibility approval question with its decision. */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

/**
 * Append the durable compatibility policy override.
 * @param session - the Session whose effective policy changes.
 * @param policy - the next explicit policy.
 */
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void {
  if (!APPROVAL_POLICIES.includes(policy)) {
    throw new TypeError('approval policy must be one of "ask" or "never"')
  }
  session.append('approval/policy', { policy })
}

/**
 * Read the last compatibility policy override without applying a deployment default.
 * @param session - the exact Session whose log supplies the override.
 * @returns the last policy event, or `undefined` when the log has none.
 */
export function approvalPolicyOf(session: Session): ApprovalPolicy | undefined {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Session history API migration is separate.
    const event = session.eventAt(SessionSeq(seq))
    if (event?.type === 'approval/policy') return event.data.policy
  }
  return undefined
}

/** Framework-free request passed to the compatibility approval service. */
export interface ApprovalRequest<AgentOwner> {
  readonly agent: AgentOwner
  readonly toolName: string
  readonly callId?: ToolCallId
  readonly reason?: string
  readonly signal?: AbortSignal
}

/** Compatibility service operations consumed by legacy Engine/tool consumers. */
export interface ApprovalServiceDefinition<AgentOwner> {
  readonly config: { readonly policy?: ApprovalPolicy }
  /**
   * Set the durable per-Session approval policy for the live agent.
   * @param agent - live agent whose policy changes.
   * @param policy - next effective policy.
   */
  setPolicy(agent: AgentOwner, policy: ApprovalPolicy): void
  /**
   * Ask the compatibility answerer chain for a decision inside the Agent's
   * open Session turn. The Provider appends `approval/asked` before dispatch
   * and `approval/decided` after the normalized outcome so the audit pair is
   * enclosed by that turn's durable log boundary. Calls made while no turn is
   * open reject before appending; a failure before either audit append commits
   * rejects the request. Post-commit observer failures are contained by
   * Session and do not reject the request or suppress its matching event.
   * @param request - exact operation and owner needing a decision.
   * @returns the fail-closed outcome.
   * @throws When the Session has no open turn or either audit append fails before commit.
   */
  request(request: ApprovalRequest<AgentOwner>): Promise<ApprovalOutcome>
  /**
   * Read the explicit policy override recorded in the Session log.
   * @param session - Session with the durable policy fold.
   * @returns the explicit override or undefined.
   */
  overrideOf(session: Session): ApprovalPolicy | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One compatibility approval question before its matching decision. */
    'approval/asked': {
      id: ApprovalRequestId
      toolName: string
      callId?: ToolCallId
      reason?: string
    }
    /** Closed outcome paired with a preceding compatibility approval question. */
    'approval/decided': { id: ApprovalRequestId; outcome: ApprovalOutcome }
    /** Durable per-Session policy override, never included in the model transcript. */
    'approval/policy': {
      policy: ApprovalPolicy
      /** Marks an override seeded into a child during delegation. */
      source?: 'delegation'
    }
  }
}
