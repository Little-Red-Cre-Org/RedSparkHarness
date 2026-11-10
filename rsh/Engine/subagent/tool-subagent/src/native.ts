/** Model Consumer of the selected native Subagent Provider. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { ContentBlock } from '@redspark/rsh-llm/native'
import { ReasoningEffortId } from '@redspark/rsh-llm/native'
import type { NativeExternalSubagentApprovalRequest, NativeSubagentOptions, NativeSubagentResult,
  NativeExternalSubagentResult, NativeSubagentBackground, NativeSubagentContinuation } from '@redspark/rsh-native-subagent'
import type { NativeToolExecution, NativeValueToolContribution } from '@redspark/rsh-native-tools'
import type {} from '@redspark/rsh-native-tool-jobs'

interface Config { readonly toolName: string; readonly options: NativeSubagentOptions; readonly backgroundMode: 'one-shot' | 'continuable' }

function responsesGeneration(call: NativeToolExecution): NativeToolExecution['responsesGeneration'] {
  for (let current: NativeToolExecution | undefined = call; current !== undefined; current = current.parent) {
    if (current.responsesGeneration !== undefined) return current.responsesGeneration
  }
  return undefined
}

function resolveConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native tool-subagent: configuration must be an object')
  const fields = input as Record<string, unknown>
  const permitted = ['toolName', 'maxDepth', 'maxSteps', 'provider', 'model', 'reasoningEffort', 'maxTokens', 'persona', 'toolFilter', 'backgroundMode', 'inheritCompletedTurns']
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
  const backgroundMode = fields.backgroundMode === undefined ? 'one-shot' : fields.backgroundMode
  if (backgroundMode !== 'one-shot' && backgroundMode !== 'continuable') throw new Error('native tool-subagent: backgroundMode must be one-shot or continuable')
  if (fields.inheritCompletedTurns !== undefined && typeof fields.inheritCompletedTurns !== 'boolean') {
    throw new Error('native tool-subagent: inheritCompletedTurns must be a boolean')
  }
  if (fields.inheritCompletedTurns === true && backgroundMode === 'continuable') {
    throw new Error('native tool-subagent: completed-turn seed supports one-shot runs only')
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
  return { toolName: fields.toolName as string, backgroundMode, options: {
    maxDepth: fields.maxDepth as number,
    ...fields.maxSteps === undefined ? {} : { maxSteps: fields.maxSteps as number },
    ...fields.maxTokens === undefined ? {} : { maxTokens: fields.maxTokens as number },
    ...fields.provider === undefined ? {} : { provider: fields.provider as string },
    ...fields.model === undefined ? {} : { model: fields.model as string },
    ...fields.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(fields.reasoningEffort as string) },
    ...fields.persona === undefined ? {} : { persona: fields.persona as string },
    ...toolFilter === undefined ? {} : { toolFilter },
    ...fields.inheritCompletedTurns === true ? { inheritCompletedTurns: true } : {},
  } }
}

/** Native delegation with explicit one-shot or continuable deployment. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-tool-subagent', targets: ['host'],
  requires: ['tools', 'subagents'], optional: ['jobs', 'jobControls', 'subagentControls'], provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const subagents = context.require('subagents')
      const external = subagents.providerName !== 'spawn'
      if (external && config.backgroundMode === 'continuable') {
        throw new Error('native tool-subagent: external providers support one-shot runs only')
      }
      if (external && config.options.inheritCompletedTurns === true) {
        throw new Error('native tool-subagent: completed-turn seed requires the in-process executor')
      }
      const tools = context.require('tools')
      const controls = context.optional('jobControls')
      const jobs = context.optional('jobs')
      if (controls !== undefined && (controls.jobs !== jobs || subagents.backgroundJobs !== jobs)) {
        throw new Error('native tool-subagent: Provider, jobs and jobControls must select the same Jobs registry')
      }
      const continuation = config.backgroundMode === 'continuable'
      const selectedControls = context.optional('subagentControls')
      if (continuation && (selectedControls?.subagents !== subagents || selectedControls.tools !== tools
        || subagents.continuationTools !== tools)) {
        throw new Error('native tool-subagent: continuable mode requires controls bound to the same Provider and tool registry')
      }
      const inherit = config.options.inheritCompletedTurns === true
      const background = !inherit && !external && (continuation || controls !== undefined)
      const contribution: NativeValueToolContribution = {
        schema: { name: config.toolName, description: inherit
          ? 'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all '
            + 'completed turns so far (it does not see the current in-flight turn). Use this when the subtask '
            + 'builds on this conversation\'s context — a follow-up analysis, '
            + 'a review, a continuation — without consuming this conversation\'s context for the work itself. '
            + 'You receive its result, not its intermediate steps. This call waits for its final result and cleanup.'
          : 'Delegate one task to a fresh child without your conversation. '
            + (continuation ? 'By default start a durable continuable child and return after its initial input is accepted. Use send_message for follow-ups and interrupt_agent to stop current work; run_in_background:false waits for a one-shot result.'
              : background ? 'By default wait for its final result and cleanup. run_in_background returns after child readiness; use job_output/job_kill to observe or cancel the Agent-owned job.'
                : 'This call waits for its final result and cleanup.'),
        parameters: { type: 'object', additionalProperties: false, required: ['description', 'prompt'], properties: {
          description: { type: 'string' },
          prompt: { type: 'string', ...inherit ? { description: 'The task for the subagent. It already sees this conversation\'s completed turns, so build on them freely and state only what is new.' } : {} },
          ...background ? { run_in_background: { type: 'boolean' as const } } : {},
        } } },
        output: {
          schema: { oneOf: [{ type: 'object', additionalProperties: false, required: ['id', 'provider', 'stopReason', 'output'], properties: {
            id: { type: 'string' }, provider: { type: 'string' },
            stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'] },
            output: { type: 'array', items: { type: 'object', additionalProperties: true } },
          } }, { type: 'object', additionalProperties: false, required: ['id', 'jobId', 'provider'], properties: {
            id: { type: 'string' }, jobId: { type: 'string' }, provider: { type: 'string' },
          } }, ...continuation ? [{ type: 'object' as const, additionalProperties: false, required: ['id', 'provider', 'messageId'], properties: {
            id: { type: 'string' as const }, provider: { type: 'string' as const }, messageId: { type: 'string' as const },
          } }] : [], { type: 'object', additionalProperties: false, required: ['id', 'provider', 'remoteId', 'stopReason', 'output'], properties: {
            id: { type: 'string' }, provider: { type: 'string' }, remoteId: { type: 'string' },
            stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'] },
            output: { type: 'array', items: { type: 'object', additionalProperties: true } },
          } }] },
          render: (_call, value) => {
            // The Provider supplies typed content; NativeTools owns its lossless JSON snapshot.
            const result = value as unknown as NativeSubagentResult | NativeExternalSubagentResult
              | NativeSubagentBackground | NativeSubagentContinuation
            if ('messageId' in result) return { isError: false, content: [{ type: 'text', text: `started subagent ${result.id}` }],
              meta: { kind: 'subagent', childSessionId: result.id, provider: result.provider, messageId: result.messageId } }
            if ('jobId' in result) return { isError: false, content: [{ type: 'text', text: `Background subagent started. Job: ${result.jobId}. Child session: ${result.id}. Use job_output to read output or wait; job_kill requests cancellation.` }],
              meta: { kind: 'subagent', childSessionId: result.id, provider: result.provider, jobId: result.jobId } }
            // A child's reasoning is its own; only its text answer is the parent's result.
            // Passing every block through would hand the parent model the child's private
            // chain of thought, which the compatibility tool never does.
            const content: ContentBlock[] = result.output.filter(
              (block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
            if (result.stopReason !== 'completed') content.unshift({ type: 'text', text: `Subagent ended: ${result.stopReason}. Partial output follows.` })
            return { content, isError: result.stopReason !== 'completed', meta: {
              kind: 'subagent', ...'remoteId' in result ? { externalChildId: result.id, remoteId: result.remoteId }
                : { childSessionId: result.id }, provider: result.provider, stopReason: result.stopReason,
            } }
          },
        },
        async execute(call) {
          const args = call.arguments as { description: string; prompt: string; run_in_background?: boolean }
          if (args.description.length === 0 || args.prompt.length === 0) throw new Error('subagent: description and prompt must be nonempty')
          const approvalAuthority = call.approvalAuthority
          const approvalRequester = approvalAuthority === undefined ? undefined : async (
            approval: NativeExternalSubagentApprovalRequest,
          ) => approvalAuthority.request({
            agent: call.agent, session: call.session, callId: call.callId, toolName: approval.toolName,
            reason: [
              `External child ${approval.operationId} request ${approval.requestId} (child call ${approval.callId}).`,
              approval.reason,
            ].filter((part): part is string => part !== undefined).join(' '),
            signal: AbortSignal.any([call.signal, approval.signal]),
          })
          const generation = responsesGeneration(call)
          const request = subagents.resolve({ agent: call.agent, session: call.session, label: args.description,
            prompt: [{ type: 'text', text: args.prompt }], options: config.options,
            ...call.delegationContext === undefined ? {} : { delegationContext: call.delegationContext },
            ...generation === undefined ? {} : { responsesGeneration: generation },
            ...approvalRequester === undefined ? {} : { approvalRequester } })
          return continuation && args.run_in_background !== false ? subagents.startContinuable(request, call.signal)
            : args.run_in_background === true ? subagents.startBackground(request, call.signal) : subagents.run(request, call.signal)
        },
      }
      context.own(tools.registerValueTool(contribution, context.scope))
    }
  },
}
