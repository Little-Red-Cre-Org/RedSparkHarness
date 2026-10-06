/**
 * Model-facing foreground Ralph loop over the workflow and subagent seams. A
 * fixed script starts one fresh structured-output child per round, carrying
 * only the immutable objective and the previous bounded handoff between them.
 * @module @deepseek-ai/dsh-tool-ralph
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { DESCRIPTION, RALPH_META, RALPH_SCRIPT, RALPH_OUTPUT_PROPERTIES, resolveMaxRounds,
  readRunResult, stopReasonError, renderResult, renderRoundFailure } from './runtime.ts'
import type { RalphRunResult } from './runtime.ts'

export const name = 'tool-ralph'
export const inject = ['tools', 'workflowEngine', 'subagents', 'systemPrompt']

/** Deployment policy for the fixed Ralph workflow. */
export interface Config {
  /** Fresh structured-output provider used for every round (default `spawn`). */
  subagentProvider?: string
  /** Default and deployment ceiling for one call's round count (default 256). */
  maxRounds?: number
  /** Maximum serialized characters in one structured handoff (default 16384). */
  maxHandoffChars?: number
  /** Maximum characters in a successful parent-facing terminal text (default 16384). */
  maxResultChars?: number
}

/** Schemastery configuration for the Ralph tool. */
export const Config: z<Config> = z.object({
  subagentProvider: z.string().default('spawn'),
  maxRounds: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(256),
  maxHandoffChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16_384),
  maxResultChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16_384),
})

interface ResolvedConfig {
  readonly subagentProvider: string
  readonly maxRounds: number
  readonly maxHandoffChars: number
  readonly maxResultChars: number
}

interface RalphCallArgs {
  objective: string
  maxRounds?: number
}

/** Validate defaults even when a caller invokes apply() without Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const subagentProvider = config.subagentProvider ?? 'spawn'
  const maxRounds = config.maxRounds ?? 256
  const maxHandoffChars = config.maxHandoffChars ?? 16_384
  const maxResultChars = config.maxResultChars ?? 16_384
  if (subagentProvider.length === 0 || subagentProvider !== subagentProvider.trim()) {
    throw new TypeError('subagentProvider must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    throw new TypeError('maxRounds must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxHandoffChars) || maxHandoffChars < 1) {
    throw new TypeError('maxHandoffChars must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxResultChars) || maxResultChars < 1) {
    throw new TypeError('maxResultChars must be a positive safe integer')
  }
  return { subagentProvider, maxRounds, maxHandoffChars, maxResultChars }
}

/** Require the configured route to mean a genuinely fresh structured child. */
function requireFreshProvider(ctx: Context, name: string): SubagentProvider {
  const provider = ctx.subagents.getProvider(name)
  if (provider === undefined) {
    throw new Error(`Ralph subagent provider "${name}" is not registered`)
  }
  if (!provider.capabilities.outputSchema) {
    throw new Error(`Ralph subagent provider "${name}" does not support structured output`)
  }
  if (provider.inheritsParentContext) {
    throw new Error(`Ralph subagent provider "${name}" inherits parent context; Ralph requires a fresh provider`)
  }
  return provider
}

function presentCall(args: RalphCallArgs): ToolCallView {
  return { card: 'generic', title: 'ralph', rawInput: args.objective }
}

function presentResult(args: RalphCallArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

/** Register the fixed Ralph tool and its explicit-ask usage policy. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:ralph',
    order: ctx.systemPrompt.getSectionOrder('TOOL_RALPH'),
    text: 'Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the shared workspace as durable memory. Completion and blockers are worker reports, not independent evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents or workflows for bounded delegation and fan-out.',
  })
  ctx.tools.register(defineTool({
    name: 'ralph',
    description: DESCRIPTION,
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The immutable completion objective for every fresh Ralph round.',
      },
      maxRounds: {
        type: 'number',
        description: 'Optional positive safe-integer round cap, bounded by the deployment ceiling.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: RALPH_OUTPUT_PROPERTIES,
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderResult(value.result as unknown as RalphRunResult, resolved.maxResultChars),
      }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('Ralph tool requires a calling agent (exec.agent was undefined)')
      }
      const objective = args.objective.trim()
      if (objective.length === 0) throw new Error('Ralph objective must be a non-empty string')
      const maxRounds = resolveMaxRounds(args.maxRounds, resolved.maxRounds)
      void requireFreshProvider(ctx, resolved.subagentProvider)

      const run: WorkflowRun = ctx.workflowEngine.start({
        script: RALPH_SCRIPT,
        meta: RALPH_META,
        args: { objective, maxRounds, maxHandoffChars: resolved.maxHandoffChars },
        subagentProvider: resolved.subagentProvider,
        maxTotalAgents: maxRounds,
        parent,
        signal: exec.signal,
      })
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })
      if (exec.signal.aborted) run.cancel('parent step aborted')

      try {
        const settled = await run.result
        const error = stopReasonError(settled)
        if (error !== undefined) throw new Error(error)
        const value = readRunResult(settled.value, maxRounds, resolved.maxHandoffChars)
        if (value.status === 'round-failed') throw new Error(renderRoundFailure(value, resolved.maxResultChars))
        return {
          runId: run.id,
          agentsStarted: settled.agentsStarted,
          result: value as unknown as JsonValue,
        }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        await run.dispose()
      }
    },
    presentCall,
    presentResult,
  }))
}
