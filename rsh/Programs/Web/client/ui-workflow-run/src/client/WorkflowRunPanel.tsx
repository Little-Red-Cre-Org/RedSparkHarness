import type { PropsLocale, PropsRuntime } from '@redspark/rsh-client-ui-slots'
import type { SessionListState } from '@redspark/rsh-api-session-controller/client'
import { shallowEqual } from '@redspark/rsh-client-store'
import type { SessionId } from '@redspark/rsh-session/types'
import { navigableWorkflowMembers } from '../workflow-projection.ts'
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
  return navigableWorkflowMembers(phases, parentId, (childId) => {
    if (!ordinary.has(childId)) return undefined
    const summary = sessions.byId[childId]
    if (summary === undefined) return undefined
    return {
      ...summary.origin === 'subagent' ? { origin: 'subagent' as const } : {},
      ...summary.parentId === undefined ? {} : { parentId: summary.parentId },
      running: summary.running,
    }
  })
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
