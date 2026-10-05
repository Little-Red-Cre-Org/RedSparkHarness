/**
 * Model-visible messages owned by continuable-subagent orchestration.
 *
 * @module @deepseek-ai/dsh-subagent/continuation-messages
 */

import { createAdjacentAgentMessage } from '@deepseek-ai/dsh-subagent-protocol'
export { withContinuableReturnGuidance } from '@deepseek-ai/dsh-subagent-protocol'
export type { AgentMessageSource } from '@deepseek-ai/dsh-subagent-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ActivationTerminal } from './lifecycle.ts'
import type { SubagentResult } from './types.ts'

/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link AgentMessageSource}: an Agent message is content the sender chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
export interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    'subagent-settled': SubagentSettledMessageSource
  }
}

/**
 * Build the model-visible and durable representation of one adjacent-Agent message.
 * @param sender - exact live Agent that authored the message.
 * @param content - model-visible message blocks supplied by the sender.
 * @returns the durable user-message representation delivered to the recipient.
 */
export function createAgentMessage(
  sender: Agent,
  content: ContentBlock[],
): ReturnType<typeof createUserMessage> {
  return createAdjacentAgentMessage(sender.id, content)
}

/**
 * One line telling a parent that a background child is finished and why, in
 * the parent's own task vocabulary.
 * @param childId - the durable child the parent knows by id.
 * @param stopReason - how the child's last ordinary turn ended.
 * @returns the model-facing opening line of the settlement notice.
 */
function settlementSummary(childId: SessionId, stopReason: SubagentResult['stopReason']): string {
  const subject = `Background subagent ${childId}`
  switch (stopReason) {
    case 'completed':
      return `${subject} finished and will do no further work unless you send it more.`
    case 'aborted':
      return `${subject} was stopped before it finished.`
    case 'max-tokens':
      return `${subject} ran out of room before it finished.`
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // the child had claimed, so the parent must not treat the task as done.
    case 'refusal':
      return `${subject} declined the task.`
    case 'error':
      return `${subject} failed before it finished.`
    /* v8 ignore next 4 -- `SubagentResult['stopReason']` is merge-extensible, so this arm
     * needs a backend that adds a variant; an unnameable ending is reported as unfinished
     * rather than silently as success. */
    default:
      return `${subject} ended abnormally (${String(stopReason)}) before it finished.`
  }
}

/**
 * Build the runtime-owned settlement notice delivered to a child's parent.
 * @param childId - durable child session id named in the notice.
 * @param terminal - recorded terminal state for the settled Activation.
 * @returns the durable user-message representation delivered to the parent.
 */
export function createSettlementMessage(
  childId: SessionId,
  terminal: ActivationTerminal,
): ReturnType<typeof createUserMessage> {
  const summary = settlementSummary(childId, terminal.stopReason)
  return createUserMessage({
    content: [
      { type: 'text' as const, text: summary },
      ...terminal.output === undefined
        ? [{ type: 'text' as const, text: 'It left no closing message.' }]
        : [{ type: 'text' as const, text: 'Its closing message:' }, ...terminal.output],
    ],
    source: {
      kind: 'subagent-settled' as const,
      form: 'notice' as const,
      summary: boundContextSummary(summary),
      senderSessionId: childId,
    },
  })
}
