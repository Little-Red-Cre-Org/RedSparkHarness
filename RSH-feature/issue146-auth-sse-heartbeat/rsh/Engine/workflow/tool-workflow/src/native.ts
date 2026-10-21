/** Native foreground workflow Consumer with durable child progress and canonical model output. */
import z from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { NativeWorkflowOperations } from '@deepseek-ai/dsh-workflow/native'
import type { WorkflowResult, WorkflowRunId, WorkflowMeta } from '@deepseek-ai/dsh-workflow/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { runNativeForegroundWorkflow } from './foreground.ts'
import type {} from '@deepseek-ai/dsh-native-prompt/native'

const Configuration = z.object({ provider: z.string().min(1), toolName: z.string().min(1).default('workflow'),
  promptOrder: z.number().default(600),
  maxResultChars: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(50_000),
}).strict()
const Input = z.object({ script: z.string(), meta: z.object({ name: z.string().min(1), description: z.string().min(1),
  whenToUse: z.string().optional(), phases: z.array(z.object({ title: z.string(), detail: z.string().optional(),
    provider: z.string().optional(), model: z.string().optional() }).strict()).optional(),
}).strict(), args: z.record(z.string(), z.unknown()).optional() }).strict()

/** Resolved execution Provider and result rendering ceiling. */
export type NativeWorkflowToolConfig = z.output<typeof Configuration>
/** Resolve workflow transport selection before installation.
 * @param input - profile configuration.
 * @returns validated deployment values.
 */
export function resolveNativeWorkflowToolConfig(input: unknown): NativeWorkflowToolConfig { return Configuration.parse(input) }

/** Execute one foreground script and persist member facts before returning its canonical value.
 * @param workflow - selected Definition.
 * @param config - deployment values.
 * @param call - admitted invocation.
 * @returns canonical workflow value; failures propagate after owned worker cleanup.
 */
export async function executeNativeWorkflow(workflow: NativeWorkflowOperations, config: NativeWorkflowToolConfig,
  call: NativeToolExecution): Promise<{ runId: WorkflowRunId; agentsStarted: number; result: JsonValue }> {
  const input = Input.parse(call.arguments)
  const meta: WorkflowMeta = { name: input.meta.name, description: input.meta.description,
    ...input.meta.whenToUse === undefined ? {} : { whenToUse: input.meta.whenToUse },
    ...input.meta.phases === undefined ? {} : { phases: input.meta.phases.map(phase => ({ title: phase.title,
      ...phase.detail === undefined ? {} : { detail: phase.detail },
      ...phase.provider === undefined ? {} : { provider: phase.provider },
      ...phase.model === undefined ? {} : { model: phase.model },
    })) },
  }
  const settled = await runNativeForegroundWorkflow(workflow, config.provider, { parent: call, script: input.script, meta,
    ...input.args === undefined ? {} : { args: input.args }, signal: call.signal })
  assertCompleted(settled.result)
  return { runId: settled.runId, agentsStarted: settled.result.agentsStarted, result: settled.result.value as JsonValue }
}

function assertCompleted(result: WorkflowResult): void {
  switch (result.stopReason) {
    case 'completed': return
    case 'cancelled': throw new Error(`workflow run was cancelled (${result.error ?? 'cancelled'})`)
    case 'error': throw new Error(`workflow run failed: ${result.error ?? 'unknown error'}`)
    default: throw new Error(`workflow run ended abnormally (${String(result.stopReason satisfies never)})`)
  }
}

/** Model-facing foreground orchestration backed by a selected native worker Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-workflow', targets: ['host'], requires: ['workflow', 'tools', 'promptSections'], provides: [],
  resolve(input) {
    const config = resolveNativeWorkflowToolConfig(input)
    return (context) => {
      const workflow = context.require('workflow')
      if (workflow.provider(config.provider, context.scope) === undefined) throw new Error('native-workflow-tool: Provider is missing')
      context.effect(context.require('promptSections').register({ name: `tool:${config.toolName}`, order: config.promptOrder,
        text: () => `Use ${config.toolName} only when the user explicitly requests a workflow or large multi-agent orchestration. For one or two delegations, prefer subagent calls.`,
      }, context.scope))
      context.effect(context.require('tools').registerValueTool({
        schema: { name: config.toolName,
          description: 'Run a foreground JavaScript workflow body with top-level await and return JSON. Hooks: agent(prompt, {schema?, label?, phase?, provider?, model?}), parallel(thunks), pipeline(items, ...stages), phase(title), log(message), args. Child failures become null; invalid options, unsupported schemas and resource caps fail the run. No filesystem, network, timers or Node APIs are provided. The worker is containment, not a security boundary.',
          parameters: { type: 'object', properties: { script: { type: 'string' }, meta: { type: 'object',
            properties: { name: { type: 'string' }, description: { type: 'string' }, whenToUse: { type: 'string' },
              phases: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' },
                provider: { type: 'string' }, model: { type: 'string' } }, required: ['title'], additionalProperties: false } } },
            required: ['name', 'description'], additionalProperties: false }, args: { type: 'object', additionalProperties: true } },
          required: ['script', 'meta'], additionalProperties: false },
        },
        isConcurrencySafe: () => true,
        output: { schema: { type: 'object', properties: { runId: { type: 'string' }, agentsStarted: { type: 'integer' }, result: {} },
          required: ['runId', 'agentsStarted', 'result'], additionalProperties: false },
        render: (call, value) => {
          const result = value as { runId: WorkflowRunId; agentsStarted: number; result: JsonValue }
          const name = (call.arguments as z.output<typeof Input>).meta.name
          const text = JSON.stringify(result.result, null, 2)
          const clipped = text.length > config.maxResultChars
            ? `${text.slice(0, config.maxResultChars)}\n… [truncated: ${text.length - config.maxResultChars} more characters]` : text
          return { content: [{ type: 'text', text: `workflow "${name}" completed (${result.agentsStarted} agent${result.agentsStarted === 1 ? '' : 's'}).\nReturn value:\n${clipped}` }],
            isError: false, meta: value }
        },
        },
        execute: call => executeNativeWorkflow(workflow, config, call),
      }, context.scope))
    }
  },
}
