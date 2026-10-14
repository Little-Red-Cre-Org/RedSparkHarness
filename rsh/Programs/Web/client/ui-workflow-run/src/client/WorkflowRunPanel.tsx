import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkflowRunView } from '../WorkflowRunView.tsx'
import type { WorkflowRunPhaseData } from './workflow-definition.ts'

/** Navigation action injected from the plugin's own Session Controller access. */
export interface WorkflowRunInjected {
  readonly openSession: (id: SessionId) => void
}

/** Complete keyed Chat renderer props. */
export type WorkflowRunPanelProps =
  PropsRuntime<'conversation.chat.node', 'workflow-run'>
  & PropsLocale<'workflowRun'>
  & WorkflowRunInjected

function navigableMembers(
  sessions: SessionListState,
  phases: readonly WorkflowRunPhaseData[],
  parentId: SessionId,
): readonly SessionId[] {
  const ordinary = new Set(sessions.ids)
  const result: SessionId[] = []
  for (const phase of phases) {
    for (const member of phase.members) {
      const summary = sessions.byId[member.childId]
      if (member.status === 'running'
        && ordinary.has(member.childId)
        && summary?.origin === 'subagent'
        && summary.parentId === parentId
        && summary.running) {
        result.push(member.childId)
      }
    }
  }
  return result
}

/** Adapt Cordis Session navigation to the shared workflow view.
 * @param props - keyed Chat node, Session hooks, navigation and localized copy.
 * @returns the workflow run display with eligible live child navigation.
 */
export function WorkflowRunPanel({ node, sessionId, useSessions, openSession, t }: WorkflowRunPanelProps) {
  const navigable = useSessions(
    sessions => navigableMembers(sessions, node.data.phases, sessionId),
    shallowEqual,
  )
  return <WorkflowRunView data={node.data} navigable={navigable} openSession={openSession} t={t} />
}
