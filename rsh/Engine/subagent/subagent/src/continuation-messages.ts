/**
 * Model-visible messages owned by continuable-subagent orchestration.
 *
 * @module @redspark/rsh-subagent/continuation-messages
 */

import { createAdjacentAgentMessage } from '@redspark/rsh-subagent-protocol'
export { withContinuableReturnGuidance } from '@redspark/rsh-subagent-protocol'
export { createSettlementMessage } from '@redspark/rsh-subagent-protocol'
export type { SubagentSettledMessageSource } from '@redspark/rsh-subagent-protocol'
export type { AgentMessageSource } from '@redspark/rsh-subagent-protocol'
import type { Agent } from '@redspark/rsh-agent'
import type { createUserMessage } from '@redspark/rsh-llm'
import type { ContentBlock } from '@redspark/rsh-llm'

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
