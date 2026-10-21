/** Shared foreground lifecycle and durable member recording for native workflow Consumers. */
import type { NativeWorkflowOperations, NativeWorkflowObserver, NativeWorkflowStartRequest } from '@deepseek-ai/dsh-workflow/native'
import type { WorkflowResult, WorkflowRunId } from '@deepseek-ai/dsh-workflow/types'
import type {} from './types.ts'

/** Worker settlement after Consumer-owned progress recording and disposal. */
export interface NativeForegroundWorkflowResult {
  readonly runId: WorkflowRunId
  readonly result: WorkflowResult
}

/** Execute an explicit script and persist its top-level member lifecycle.
 * @param workflow - selected Definition.
 * @param provider - selected execution Provider.
 * @param request - admitted invocation, script, cancellation and per-run policy.
 * @returns worker settlement after recording and cleanup; infrastructure failures reject.
 */
export async function runNativeForegroundWorkflow(workflow: NativeWorkflowOperations, provider: string,
  request: Omit<NativeWorkflowStartRequest, 'observer'>): Promise<NativeForegroundWorkflowResult> {
  const call = request.parent
  let records = Promise.resolve()
  const recording: { failure?: { error: unknown } } = {}
  const record = (operation: () => Promise<unknown>): void => {
    records = records.then(async () => { if (recording.failure === undefined) await operation() }).catch((error: unknown) => {
      recording.failure = { error }
      run.cancel('workflow durable recording failed')
    })
  }
  const observer: NativeWorkflowObserver = {
    phase: () => {}, log: () => {},
    agentStart: (agent) => { if (call.parent === undefined) record(() => call.appendEvent('tool-workflow/agent-start', { runId,
      seq: agent.seq, label: agent.label, childId: agent.childId, ...agent.phase === undefined ? {} : { phase: agent.phase },
    })) },
    agentEnd: (agent) => { if (call.parent === undefined) record(() => call.appendEvent('tool-workflow/agent-end', { runId, seq: agent.seq, outcome: agent.outcome })) },
  }
  const run = workflow.start(provider, { ...request, observer })
  const runId = run.id
  if (call.parent === undefined) record(() => call.appendEvent('tool-workflow/run-start', { runId, name: run.meta.name }))
  const [result] = await Promise.allSettled([run.result])
  const [cleanup] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  await records
  if (result.status === 'rejected') throw result.reason
  if (cleanup.status === 'rejected') throw cleanup.reason
  if (recording.failure !== undefined) throw recording.failure.error
  if (call.parent === undefined) await call.appendEvent('tool-workflow/run-end', { runId, stopReason: result.value.stopReason })
  request.signal.throwIfAborted()
  return { runId, result: result.value }
}
