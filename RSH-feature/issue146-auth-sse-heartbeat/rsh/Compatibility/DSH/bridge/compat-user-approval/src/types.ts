/** Cordis answerer event for the compatibility approval Service. */
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type {
  ApprovalRequest as DefinitionApprovalRequest,
  ApprovalOutcome,
  ApprovalServiceDefinition as DefinitionApprovalServiceDefinition,
} from '@deepseek-ai/dsh-approval-definition/legacy'

export type {
  ApprovalOutcome,
  ApprovalPolicy,
} from '@deepseek-ai/dsh-approval-definition/legacy'
export { APPROVAL_POLICIES, ApprovalRequestId } from '@deepseek-ai/dsh-approval-definition/legacy'

/** Cordis implementation specialized to the exact scoped Agent owner. */
export interface ApprovalServiceDefinition extends DefinitionApprovalServiceDefinition<Agent> {}

/** Client-safe values sent through the compatibility answerer waterfall. */
export interface ApprovalRequestEvent {
  /** Agent identity projected to the corresponding Client Context in transit. */
  readonly agent: Agent
  /** Tool whose operation requires a decision. */
  readonly toolName: string
  /** Exact tool call being decided, when available. */
  readonly callId?: ToolCallId
  /** Human-readable reason supplied by the asker. */
  readonly reason?: string
  /** Cancellation lifetime of the pending request. */
  readonly signal?: AbortSignal
}

/** Same-process request passed to the compatibility approval service. */
export interface ApprovalRequest extends Omit<DefinitionApprovalRequest<Agent>, 'agent'> {
  readonly agent: Agent
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask composed answerers for one decision. Return an outcome to claim it or call `next()` to delegate.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) limits listeners to the requesting Agent's scope.
     * @param req - pending approval request.
     * @mode waterfall
     */
    'approval/request'(
      this: Scoped<Agent>,
      req: ApprovalRequestEvent,
      next: () => Promise<ApprovalOutcome>,
    ): Promise<ApprovalOutcome>
  }
}
