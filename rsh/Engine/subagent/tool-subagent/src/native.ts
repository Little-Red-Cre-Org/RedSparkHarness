/** Foreground model Consumer of the selected native Subagent Provider. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import type { NativeSubagentOptions, NativeSubagentResult } from '@deepseek-ai/dsh-native-subagent'
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'

interface Config { readonly toolName: string; readonly options: NativeSubagentOptions }

function resolveConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native tool-subagent: configuration must be an object')
  const fields = input as Record<string, unknown>
  const permitted = ['toolName', 'maxDepth', 'maxSteps', 'provider', 'model', 'reasoningEffort', 'maxTokens', 'persona', 'toolFilter']
  for (const key of Object.keys(fields)) if (!permitted.includes(key)) throw new Error(`native tool-subagent: unsupported configuration field ${key}`)
  for (const key of ['toolName', 'provider', 'model', 'reasoningEffort', 'persona']) {
    if ((key === 'toolName' || fields[key] !== undefined) && (typeof fields[key] !== 'string' || fields[key].length === 0)) {
      throw new Error(`native tool-subagent: ${key} must be a nonempty string`)
    }
  }
  for (const key of ['maxDepth', 'maxSteps', 'maxTokens']) {
    const value = fields[key]
    if ((key === 'maxDepth' || value !== undefined) && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (key === 'maxDepth' ? 0 : 1))) {
      throw new Error(`native tool-subagent: ${key} must be a ${key === 'maxDepth' ? 'non-negative' : 'positive'} safe integer`)
    }
  }
  let toolFilter: NativeSubagentOptions['toolFilter']
  if (fields.toolFilter !== undefined) {
    const filter = fields.toolFilter
    if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) throw new Error('native tool-subagent: toolFilter must be an object')
    const values = filter as Record<string, unknown>
    if (Object.keys(values).some(key => key !== 'allow' && key !== 'deny') || values.allow === undefined && values.deny === undefined) {
      throw new Error('native tool-subagent: toolFilter must declare allow or deny')
    }
    for (const key of ['allow', 'deny']) {
      if (values[key] !== undefined && (!Array.isArray(values[key]) || values[key].some(value => typeof value !== 'string' || value.length === 0))) {
        throw new Error(`native tool-subagent: toolFilter.${key} must contain tool names`)
      }
    }
    toolFilter = { ...values.allow === undefined ? {} : { allow: [...values.allow as string[]] },
      ...values.deny === undefined ? {} : { deny: [...values.deny as string[]] } }
  }
  return { toolName: fields.toolName as string, options: {
    maxDepth: fields.maxDepth as number,
    ...fields.maxSteps === undefined ? {} : { maxSteps: fields.maxSteps as number },
    ...fields.maxTokens === undefined ? {} : { maxTokens: fields.maxTokens as number },
    ...fields.provider === undefined ? {} : { provider: fields.provider as string },
    ...fields.model === undefined ? {} : { model: fields.model as string },
    ...fields.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(fields.reasoningEffort as string) },
    ...fields.persona === undefined ? {} : { persona: fields.persona as string },
    ...toolFilter === undefined ? {} : { toolFilter },
  } }
}

/** Native foreground delegation; background and continuable requests are unsupported and refused. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-subagent', targets: ['host'],
  requires: ['tools', 'subagents'], provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const subagents = context.require('subagents')
      const tools = context.require('tools')
      const contribution: NativeValueToolContribution = {
        schema: { name: config.toolName, description: 'Delegate one task to a fresh foreground child. '
          + 'The child starts without your conversation; this call waits for its final result and cleanup.',
        parameters: { type: 'object', additionalProperties: false, required: ['description', 'prompt'], properties: {
          description: { type: 'string' }, prompt: { type: 'string' },
        } } },
        output: {
          schema: { type: 'object', additionalProperties: false, required: ['id', 'provider', 'stopReason', 'output'], properties: {
            id: { type: 'string' }, provider: { type: 'string' },
            stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'] },
            output: { type: 'array', items: { type: 'object', additionalProperties: true } },
          } },
          render: (_call, value) => {
            // The Provider supplies typed content; NativeTools owns its lossless JSON snapshot.
            const result = value as unknown as NativeSubagentResult
            const content: ContentBlock[] = [...result.output]
            if (result.stopReason !== 'completed') content.unshift({ type: 'text', text: `Subagent ended: ${result.stopReason}. Partial output follows.` })
            return { content, isError: result.stopReason !== 'completed', meta: {
              kind: 'subagent', childSessionId: result.id, provider: result.provider, stopReason: result.stopReason,
            } }
          },
        },
        async execute(call) {
          const args = call.arguments as { description: string; prompt: string }
          if (args.description.length === 0 || args.prompt.length === 0) throw new Error('subagent: description and prompt must be nonempty')
          const request = subagents.resolve({ agent: call.agent, session: call.session, label: args.description,
            prompt: [{ type: 'text', text: args.prompt }], options: config.options })
          return subagents.run(request, call.signal)
        },
      }
      context.own(tools.registerValueTool(contribution, context.scope))
    }
  },
}
