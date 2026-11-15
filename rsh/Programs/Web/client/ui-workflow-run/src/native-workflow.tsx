/** Cordis-free workflow run projection and presentation. */
import type { SessionEvent, SessionId } from '@redspark/rsh-session/types'
import type { Translate } from '@redspark/rsh-client-ui-slots'
import { WorkflowRunView } from './WorkflowRunView.tsx'
import {
  projectWorkflowState, updateAgentEnd, updateAgentStart,
  type WorkflowRunChatData, type WorkflowState,
} from './workflow-projection.ts'

export { navigableWorkflowMembers } from './workflow-projection.ts'
import { en, zh, type WorkflowRunKey } from './client/locales.ts'

/** One Native run anchored at its durable run-start sequence. */
export interface NativeWorkflowRunRecord {
  readonly seq: number
  readonly data: WorkflowRunChatData
}

/** Project workflow runs using only accepted durable Session events.
 * @param events - ordered history or followed events from the selected Session.
 * @returns one run per run-start, ordered by that start, including zero-member runs.
 */
export function workflowRunsFromSessionEvents(events: readonly SessionEvent[]): readonly NativeWorkflowRunRecord[] {
  const runs = new Map<string, { seq: number; turn: number | undefined; step: number | undefined; state: WorkflowState }>()
  const closedTurns = new Set<number>()
  const closedSteps = new Set<string>()
  let turn: number | undefined
  let step: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') { turn = event.data.turn; step = undefined }
    if (event.type === 'step/start') { turn = event.data.turn; step = event.data.step }
    if (event.type === 'step/end') {
      closedSteps.add(`${event.data.turn}:${event.data.step}`)
      if (turn === event.data.turn && step === event.data.step) step = undefined
    }
    if (event.type === 'turn/end') {
      closedTurns.add(event.data.turn)
      if (turn === event.data.turn) { turn = undefined; step = undefined }
    }
    if (event.type === 'tool-workflow/run-start') {
      runs.set(String(event.data.runId), { seq: event.seq, turn, step, state: { name: event.data.name, members: [] } })
    } else if (event.type === 'tool-workflow/agent-start' || event.type === 'tool-workflow/agent-end'
      || event.type === 'tool-workflow/run-end') {
      const run = runs.get(String(event.data.runId))
      if (run === undefined) continue
      if (event.type === 'tool-workflow/agent-start') run.state = updateAgentStart(run.state, event.data)
      else if (event.type === 'tool-workflow/agent-end') run.state = updateAgentEnd(run.state, event.data)
      else run.state = { ...run.state, stopReason: event.data.stopReason }
    }
  }
  return [...runs.values()].map(run => ({
    seq: run.seq,
    data: projectWorkflowState(run.state, run.turn !== undefined && (closedTurns.has(run.turn)
      || (run.step !== undefined && closedSteps.has(`${run.turn}:${run.step}`)))),
  }))
}

const NO_NAVIGATION: readonly never[] = []
/* v8 ignore next -- an omitted openSession also clears navigable, so the view cannot invoke this callback. */
function readOnly(): void {}

/** Render a workflow run using the shared presentation.
 * A member opens only when both `navigable` and `openSession` are provided; otherwise the row stays non-interactive.
 * @param props - durable projected run, Native locale, eligible child ids, and the select callback.
 * @returns status-driven workflow and phase disclosures.
 */
export function NativeWorkflowRunPanel({ data, locale, navigable, openSession }: {
  readonly data: WorkflowRunChatData
  readonly locale: 'en' | 'zh'
  /** Child ids already proven eligible. Omitted, or omitted `openSession`, keeps every member non-interactive. */
  readonly navigable?: readonly SessionId[]
  /** Selects the child Session. Omitted keeps every member non-interactive. */
  readonly openSession?: (id: SessionId) => void
}) {
  const dictionary = locale === 'zh' ? zh : en
  const t: Translate<WorkflowRunKey> = (key, params) => {
    let value = dictionary[key]
    for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
    return value
  }
  return <WorkflowRunView
    data={data}
    navigable={openSession === undefined || navigable === undefined ? NO_NAVIGATION : navigable}
    openSession={openSession ?? readOnly}
    t={t}
  />
}
