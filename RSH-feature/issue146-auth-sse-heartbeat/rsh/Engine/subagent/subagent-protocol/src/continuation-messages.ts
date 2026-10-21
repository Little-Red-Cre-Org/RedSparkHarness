/** Durable adjacent-Agent attribution and continuation guidance shared by both runtimes. */
import { createUserMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionId } from '@deepseek-ai/dsh-session/native'

/** Durable attribution for one model-authored message between adjacent Agents. */
export interface AgentMessageSource {
  readonly kind: 'agent-message'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the Agent whose tool call produced the message. */
  readonly senderSessionId: SessionId
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap { 'agent-message': AgentMessageSource }
}

/** Build one durable model-authored input after the Provider has authorized sender adjacency.
 * @param senderSessionId - exact live sender's durable identity.
 * @param content - model-visible blocks supplied by that sender.
 * @returns identified input with adjacent-Agent attribution and the existing relay prefix.
 */
export function createAdjacentAgentMessage(senderSessionId: SessionId, content: ContentBlock[]): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: `Agent ${senderSessionId} sent a message: ` }, ...content],
    source: { kind: 'agent-message', form: 'relay', senderSessionId },
  })
}

/**
 * Append adjacent-Agent return guidance to a continuable child's initial task.
 * @param parentId - durable parent session id named in the guidance.
 * @param prompt - initial model-visible task blocks.
 * @returns task blocks followed by the continuable return guidance.
 */
export function withContinuableReturnGuidance(
  parentId: SessionId,
  prompt: ContentBlock[],
): ContentBlock[] {
  const encodedParentId = JSON.stringify(parentId)
  return [
    ...prompt,
    {
      type: 'text',
      text: `Your parent agent id is ${encodedParentId}. Before you finish, send your result to that agent with `
        + `send_message({ agent_id: ${encodedParentId}, message: "<self-contained result>" }). The parent shares `
        + 'your workspace but does not automatically receive your transcript, tool output, or reasoning. Send '
        + 'earlier messages as well when a finding changes what the parent should do next; sending a message '
        + 'does not end your turn.',
    },
  ]
}
