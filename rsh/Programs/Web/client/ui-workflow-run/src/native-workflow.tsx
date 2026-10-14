/** Cordis-free workflow run projection and read-only presentation. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkflowRunView } from './WorkflowRunView.tsx'
import {
  projectWorkflowState, updateAgentEnd, updateAgentStart,
  type WorkflowRunChatData, type WorkflowState,
} from './workflow-projection.ts'
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
function readOnly(): void {}

/** Render a workflow run with read-only members using the shared Cordis presentation.
 * @param props - durable projected run and Native locale.
 * @returns status-driven workflow and phase disclosures.
 */
export function NativeWorkflowRunPanel({ data, locale }: {
  readonly data: WorkflowRunChatData
  readonly locale: 'en' | 'zh'
}) {
  const dictionary = locale === 'zh' ? zh : en
  const t: Translate<WorkflowRunKey> = (key, params) => {
    let value = dictionary[key]
    for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
    return value
  }
  return <WorkflowRunView data={data} navigable={NO_NAVIGATION} openSession={readOnly} t={t} />
}
