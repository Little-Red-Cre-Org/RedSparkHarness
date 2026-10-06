/** Native fixed-script Ralph Consumer over the shared workflow and fresh Subagent Definitions. */
import z from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { NativeSubagentOperations } from '@deepseek-ai/dsh-native-subagent/native'
import type { NativeWorkflowOperations } from '@deepseek-ai/dsh-workflow/native'
import { runNativeForegroundWorkflow } from '@deepseek-ai/dsh-tool-workflow/foreground'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow/types'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import { RALPH_META, RALPH_SCRIPT, DESCRIPTION, resolveMaxRounds, readRunResult, stopReasonError, renderResult,
  renderRoundFailure, type RalphRunResult } from './runtime.ts'

const Configuration = z.object({ workflowProvider: z.string().min(1).refine(value => value === value.trim(), 'Provider name must be normalized'), subagentProvider: z.string().min(1).refine(value => value === value.trim(), 'Provider name must be normalized'),
  maxRounds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(256),
  maxHandoffChars: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(16_384),
  maxResultChars: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(16_384),
  promptOrder: z.number().default(700),
}).strict()
const Input = z.object({ objective: z.string(), maxRounds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict()

/** Explicit native routes and bounded fresh-child iteration policy. */
export type NativeRalphConfig = z.output<typeof Configuration>

/** Resolve selected routes and text/iteration limits before installation.
 * @param input - profile configuration.
 * @returns validated deployment policy.
 */
export function resolveNativeRalphConfig(input: unknown): NativeRalphConfig { return Configuration.parse(input) }

/** Require a visible structured-output one-shot Provider; the native Definition requires a fresh child.
 * @param subagents - shared Subagent Definition.
 * @param name - selected transport.
 * @param scope - consuming installation or Agent scope.
 */
export function requireNativeRalphProvider(subagents: NativeSubagentOperations, name: string): void {
  if (subagents.providerName !== name) throw new Error(`Ralph subagent transport "${name}" is not selected`)
  if (subagents.continuationTools === undefined) throw new Error('Ralph structured output requires the native tools registry')
}

/** Execute the immutable Ralph script through a selected workflow Provider.
 * @param workflow - shared workflow Definition.
 * @param subagents - fresh child Definition.
 * @param config - resolved deployment policy.
 * @param call - admitted model invocation.
 * @returns canonical worker-reported terminal progress; failed children and invalid reports reject after cleanup.
 */
export async function executeNativeRalph(workflow: NativeWorkflowOperations, subagents: NativeSubagentOperations,
  config: NativeRalphConfig, call: NativeToolExecution): Promise<{ runId: WorkflowRunId; agentsStarted: number; result: JsonValue }> {
  const input = Input.parse(call.arguments)
  const objective = input.objective.trim()
  if (objective.length === 0) throw new Error('Ralph objective must be a non-empty string')
  const maxRounds = resolveMaxRounds(input.maxRounds, config.maxRounds)
  requireNativeRalphProvider(subagents, config.subagentProvider)
  const settled = await runNativeForegroundWorkflow(workflow, config.workflowProvider, { parent: call, script: RALPH_SCRIPT,
    meta: RALPH_META, args: { objective, maxRounds, maxHandoffChars: config.maxHandoffChars },
    subagentProvider: config.subagentProvider, maxTotalAgents: maxRounds, signal: call.signal,
  })
  const error = stopReasonError(settled.result)
  if (error !== undefined) throw new Error(error)
  const value = readRunResult(settled.result.value, maxRounds, config.maxHandoffChars)
  if (value.status === 'round-failed') throw new Error(renderRoundFailure(value, config.maxResultChars))
  return { runId: settled.runId, agentsStarted: settled.result.agentsStarted, result: value as unknown as JsonValue }
}

/** Fixed-script Consumer; installation disposal cancels and drains its accepted executions. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-ralph', targets: ['host'],
  requires: ['tools', 'workflow', 'subagents', 'promptSections'], provides: [],
  resolve(input) {
    const config = resolveNativeRalphConfig(input)
    return (context) => {
      const workflow = context.require('workflow')
      const subagents = context.require('subagents')
      if (workflow.provider(config.workflowProvider, context.scope) === undefined) throw new Error('Ralph workflow Provider is missing')
      requireNativeRalphProvider(subagents, config.subagentProvider)
      const cancellation = new AbortController()
      const pending = new Set<Promise<unknown>>()
      context.own(async () => {
        cancellation.abort({ kind: 'disposed' })
        await Promise.allSettled(pending)
      })
      context.effect(context.require('promptSections').register({ name: 'tool:ralph', order: config.promptOrder,
        text: () => 'Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the shared workspace as durable memory. Completion and blockers are worker reports, not independent evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents or workflows for bounded delegation and fan-out.',
      }, context.scope))
      context.effect(context.require('tools').registerValueTool({
        schema: { name: 'ralph', description: DESCRIPTION, parameters: { type: 'object', properties: {
          objective: { type: 'string', description: 'The immutable completion objective for every fresh Ralph round.' },
          maxRounds: { type: 'integer', description: 'Optional positive safe-integer round cap, bounded by the deployment ceiling.' },
        }, required: ['objective'], additionalProperties: false } },
        isConcurrencySafe: () => true,
        output: { schema: { type: 'object', properties: { runId: { type: 'string' }, agentsStarted: { type: 'integer' }, result: {} },
          required: ['runId', 'agentsStarted', 'result'], additionalProperties: false },
        render: (_call, value) => {
          const result = value as unknown as { result: RalphRunResult }
          return { content: [{ type: 'text', text: renderResult(result.result, config.maxResultChars) }], isError: false, meta: value }
        },
        },
        execute: (call) => {
          const operation = executeNativeRalph(workflow, subagents, config, { ...call,
            signal: AbortSignal.any([call.signal, cancellation.signal, context.signal]) })
          pending.add(operation)
          void operation.then(() => { pending.delete(operation) }, () => { pending.delete(operation) })
          return operation
        },
      }, context.scope))
    }
  },
}
