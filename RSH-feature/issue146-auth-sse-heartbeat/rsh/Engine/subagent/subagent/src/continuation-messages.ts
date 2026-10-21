/**
 * Model-visible messages owned by continuable-subagent orchestration.
 *
 * @module @deepseek-ai/dsh-subagent/continuation-messages
 */

import { createAdjacentAgentMessage } from '@deepseek-ai/dsh-subagent-protocol'
export { withContinuableReturnGuidance } from '@deepseek-ai/dsh-subagent-protocol'
export { createSettlementMessage } from '@deepseek-ai/dsh-subagent-protocol'
export type { SubagentSettledMessageSource } from '@deepseek-ai/dsh-subagent-protocol'
export type { AgentMessageSource } from '@deepseek-ai/dsh-subagent-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

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
