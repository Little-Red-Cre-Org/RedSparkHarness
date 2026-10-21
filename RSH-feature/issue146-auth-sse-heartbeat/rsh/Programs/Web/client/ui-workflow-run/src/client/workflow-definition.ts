import type { ConversationLocation, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { projectWorkflowState, updateAgentEnd, updateAgentStart, type WorkflowRunChatData, type WorkflowState } from '../workflow-projection.ts'

export type { WorkflowRunChatData, WorkflowRunMemberData, WorkflowRunPhaseData, WorkflowRunStatus } from '../workflow-projection.ts'
export { workflowPhaseKey } from '../workflow-projection.ts'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Durable top-level workflow run and all members that actually started. */
    'workflow-run': WorkflowRunChatData
  }
}

function locationClosed(location: ConversationLocation): boolean {
  if (location.kind === 'step') {
    return location.step.status === 'closed' || location.turn.status === 'closed'
  }
  return location.kind === 'turn' && location.turn.status === 'closed'
}

/** Durable workflow event family folded into one keyed Chat node. */
export const workflowRunDefinition: ConversationNodeDefinition<WorkflowState> = {
  kind: 'workflow-run',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool-workflow/run-start') return { id: String(event.data.runId), role: 'start' }
    if (event.type === 'tool-workflow/agent-start'
      || event.type === 'tool-workflow/agent-end'
      || event.type === 'tool-workflow/run-end') {
      return { id: String(event.data.runId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool-workflow/run-start') {
      throw new Error('workflow-run start requires tool-workflow/run-start')
    }
    return { name: match.event.data.name, members: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool-workflow/agent-start') {
      return updateAgentStart(context.state, match.event.data)
    }
    if (match.event.type === 'tool-workflow/agent-end') {
      return updateAgentEnd(context.state, match.event.data)
    }
    if (match.event.type === 'tool-workflow/run-end') {
      return { ...context.state, stopReason: match.event.data.stopReason }
    }
    return context.state
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    const data = projectWorkflowState(context.state as WorkflowState, locationClosed(context.start.location))
    return {
      key: context.key,
      kind: 'workflow-run',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data,
    }
  },
}
