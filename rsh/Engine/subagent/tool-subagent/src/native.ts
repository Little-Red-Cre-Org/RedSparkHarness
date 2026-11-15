/** Model Consumer of the selected native Subagent Provider. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { ContentBlock } from '@redspark/rsh-llm/native'
import { ReasoningEffortId } from '@redspark/rsh-llm/native'
import type { NativeExternalSubagentApprovalRequest, NativeSubagentOptions, NativeSubagentResult, NativeSubagentStopReason,
  NativeExternalSubagentResult, NativeSubagentBackground, NativeExternalSubagentBackground, NativeSubagentContinuation } from '@redspark/rsh-native-subagent'
import type { NativeToolExecution, NativeValueToolContribution } from '@redspark/rsh-native-tools'
import type {} from '@redspark/rsh-native-tool-jobs'

interface AllowedModelRoute { readonly provider: string; readonly model: string }
interface Config {
  readonly toolName: string
  readonly options: NativeSubagentOptions
  readonly backgroundMode: 'one-shot' | 'continuable'
  readonly allowedModels?: readonly AllowedModelRoute[]
}

function nonemptyRouteField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`native tool-subagent: ${field} must be a nonempty string`)
  return value
}

function allowedModels(value: unknown): readonly AllowedModelRoute[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) throw new Error('native tool-subagent: allowedModels must list at least one route')
  const seen = new Set<string>()
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('native tool-subagent: allowedModels entries must be provider/model objects')
    }
    const fields = entry as Record<string, unknown>
    if (Object.keys(fields).some(key => key !== 'provider' && key !== 'model')) {
      throw new Error('native tool-subagent: allowedModels entries accept only provider and model')
    }
    const route = { provider: nonemptyRouteField(fields.provider, 'allowedModels.provider'), model: nonemptyRouteField(fields.model, 'allowedModels.model') }
    const key = `${route.provider}\0${route.model}`
    if (seen.has(key)) throw new Error(`native tool-subagent: allowedModels repeats route "${route.provider}/${route.model}"`)
    seen.add(key)
    return route
  })
}

function selectedOptions(
  config: Config,
  args: { readonly provider?: string; readonly model?: string; readonly reasoning_effort?: string },
): NativeSubagentOptions {
  const requested = args.provider !== undefined || args.model !== undefined || args.reasoning_effort !== undefined
  if (!requested) return config.options
  if (config.allowedModels === undefined) throw new Error('native tool-subagent: child route fields require allowedModels')
  if (args.provider !== undefined) nonemptyRouteField(args.provider, 'provider')
  if (args.model !== undefined) nonemptyRouteField(args.model, 'model')
  if (args.reasoning_effort !== undefined) nonemptyRouteField(args.reasoning_effort, 'reasoning_effort')
  if ((args.provider === undefined) !== (args.model === undefined)) {
    throw new Error('native tool-subagent: provider and model must be supplied together')
  }
  const provider = args.provider ?? config.options.provider
  const model = args.model ?? config.options.model
  if (provider === undefined || model === undefined) {
    throw new Error('native tool-subagent: provider and model must be supplied together')
  }
  if (!config.allowedModels.some(route => route.provider === provider && route.model === model)) {
    throw new Error(`native tool-subagent: child route "${provider}/${model}" is not allowed`)
  }
  const routeChanged = args.provider !== undefined && (args.provider !== config.options.provider || args.model !== config.options.model)
  const { reasoningEffort: _configuredEffort, ...withoutEffort } = config.options
  return {
    ...(routeChanged && args.reasoning_effort === undefined ? withoutEffort : config.options),
    ...args.provider === undefined ? {} : { provider: args.provider, model },
    ...args.reasoning_effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(args.reasoning_effort) },
  }
}

function responsesGeneration(call: NativeToolExecution): NativeToolExecution['responsesGeneration'] {
  for (let current: NativeToolExecution | undefined = call; current !== undefined; current = current.parent) {
    if (current.responsesGeneration !== undefined) return current.responsesGeneration
  }
  return undefined
}

/**
 * Name one non-completed child outcome in the terms the compatibility tool uses.
 * @param reason - the child's terminal stop reason.
 * @returns the model-facing headline shown before the child's partial output.
 */
function stopReasonHeadline(reason: NativeSubagentStopReason): string {
  switch (reason) {
    case 'max-tokens': return 'subagent run hit its token limit before finishing'
    case 'aborted': return 'subagent run was cancelled'
    case 'refusal': return 'subagent declined the task'
    case 'error': return 'subagent run failed'
    default: return `subagent run ended abnormally (${reason})`
  }
}

function resolveConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native tool-subagent: configuration must be an object')
  const fields = input as Record<string, unknown>
  const permitted = ['toolName', 'maxDepth', 'maxSteps', 'provider', 'model', 'reasoningEffort', 'maxTokens', 'persona', 'toolFilter', 'backgroundMode', 'inheritCompletedTurns', 'allowedModels']
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
  const routes = allowedModels(fields.allowedModels)
  const options: NativeSubagentOptions = {
    maxDepth: fields.maxDepth as number,
    ...fields.maxSteps === undefined ? {} : { maxSteps: fields.maxSteps as number },
    ...fields.maxTokens === undefined ? {} : { maxTokens: fields.maxTokens as number },
    ...fields.provider === undefined ? {} : { provider: fields.provider as string },
    ...fields.model === undefined ? {} : { model: fields.model as string },
    ...fields.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(fields.reasoningEffort as string) },
    ...fields.persona === undefined ? {} : { persona: fields.persona as string },
    ...toolFilter === undefined ? {} : { toolFilter },
    ...fields.inheritCompletedTurns === true ? { inheritCompletedTurns: true } : {},
  }
  if (routes !== undefined) {
    if ((options.provider === undefined) !== (options.model === undefined)
      || options.reasoningEffort !== undefined && options.provider === undefined) {
      throw new Error('native tool-subagent: allowedModels requires configured provider and model together')
    }
    if (options.provider !== undefined && options.model !== undefined
      && !routes.some(route => route.provider === options.provider && route.model === options.model)) {
      throw new Error(`native tool-subagent: configured route "${options.provider}/${options.model}" is not allowed`)
    }
  }
  return { toolName: fields.toolName as string, backgroundMode, options, ...routes === undefined ? {} : { allowedModels: routes } }
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
      const routeSelection = config.allowedModels === undefined ? ''
        : ' Supply provider and model together to select an allowed child route, and reasoning_effort for that route. Configured maxTokens remains the ceiling.'
      const background = !inherit && (external ? controls !== undefined : continuation || controls !== undefined)
      const contribution: NativeValueToolContribution = {
        schema: { name: config.toolName, description: (inherit
          ? 'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all '
            + 'completed turns so far (it does not see the current in-flight turn). Use this when the subtask '
            + 'builds on this conversation\'s context — a follow-up analysis, '
            + 'a review, a continuation — without consuming this conversation\'s context for the work itself. '
            + 'You receive its result, not its intermediate steps. This call waits for its final result and cleanup.'
          : 'Delegate one task to a fresh child without your conversation. '
            + (continuation ? 'By default start a durable continuable child and return after its initial input is accepted. Use send_message for follow-ups and interrupt_agent to stop current work; run_in_background:false waits for a one-shot result.'
              : background ? 'By default wait for its final result and cleanup. run_in_background returns after child readiness; use job_output/job_kill to observe or cancel the Agent-owned job.'
                : 'This call waits for its final result and cleanup.')) + routeSelection,
        parameters: { type: 'object', additionalProperties: false, required: ['description', 'prompt'], properties: {
          description: { type: 'string' },
          prompt: { type: 'string', ...inherit ? { description: 'The task for the subagent. It already sees this conversation\'s completed turns, so build on them freely and state only what is new.' } : {} },
          ...config.allowedModels === undefined ? {} : {
            provider: { type: 'string' as const, description: 'Child LLM provider. Supply together with model.' },
            model: { type: 'string' as const, description: 'Child model id. Supply together with provider.' },
            reasoning_effort: { type: 'string' as const, description: 'Reasoning effort for the selected child route.' },
          },
          ...background ? { run_in_background: { type: 'boolean' as const } } : {},
        } } },
        output: {
          schema: { oneOf: [{ type: 'object', additionalProperties: false, required: ['id', 'provider', 'stopReason', 'output'], properties: {
            id: { type: 'string' }, provider: { type: 'string' },
            stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'] },
            output: { type: 'array', items: { type: 'object', additionalProperties: true } },
          } }, { type: 'object', additionalProperties: false, required: ['id', 'jobId', 'provider'], properties: {
            id: { type: 'string' }, jobId: { type: 'string' }, provider: { type: 'string' },
          } }, ...external && background ? [{ type: 'object' as const, additionalProperties: false, required: ['id', 'jobId', 'provider', 'remoteId'], properties: {
            id: { type: 'string' as const }, jobId: { type: 'string' as const }, provider: { type: 'string' as const }, remoteId: { type: 'string' as const },
          } }] : [], ...continuation ? [{ type: 'object' as const, additionalProperties: false, required: ['id', 'provider', 'messageId'], properties: {
            id: { type: 'string' as const }, provider: { type: 'string' as const }, messageId: { type: 'string' as const },
          } }] : [], { type: 'object', additionalProperties: false, required: ['id', 'provider', 'remoteId', 'stopReason', 'output'], properties: {
            id: { type: 'string' }, provider: { type: 'string' }, remoteId: { type: 'string' },
            stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'] },
            output: { type: 'array', items: { type: 'object', additionalProperties: true } },
            diagnostic: { type: 'string' },
          } }] },
          render: (_call, value) => {
            // The Provider supplies typed content; NativeTools owns its lossless JSON snapshot.
            const result = value as unknown as NativeSubagentResult | NativeExternalSubagentResult
              | NativeSubagentBackground | NativeExternalSubagentBackground | NativeSubagentContinuation
            if ('messageId' in result) return { isError: false, content: [{ type: 'text', text: `started subagent ${result.id}` }],
              meta: { kind: 'subagent', childSessionId: result.id, provider: result.provider, messageId: result.messageId } }
            if ('jobId' in result && 'remoteId' in result) {
              return { isError: false, content: [{ type: 'text', text: `Background subagent started. Job: ${result.jobId}. Remote id: ${result.remoteId}. Use job_output to read output or wait; job_kill requests cancellation.` }],
                meta: { kind: 'subagent', externalChildId: result.id, remoteId: result.remoteId, provider: result.provider, jobId: result.jobId } }
            }
            if ('jobId' in result) return { isError: false, content: [{ type: 'text', text: `Background subagent started. Job: ${result.jobId}. Child session: ${result.id}. Use job_output to read output or wait; job_kill requests cancellation.` }],
              meta: { kind: 'subagent', childSessionId: result.id, provider: result.provider, jobId: result.jobId } }
            // A child's reasoning is its own; only its text answer is the parent's result.
            // Passing every block through would hand the parent model the child's private
            // chain of thought, which the compatibility tool never does.
            const content: ContentBlock[] = result.output.filter(
              (block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
            if (result.stopReason !== 'completed') {
              // The headline names what happened, then the product diagnostic, then the child's
              // own words. A model that only saw the headline could not tell a refusal from a
              // truncation, and would lose both the product detail and the partial answer.
              const partial = content.map(block => block.type === 'text' ? block.text : '').join('')
              const diagnostic = 'remoteId' in result && result.diagnostic !== undefined && result.diagnostic.length > 0
                ? `\nDiagnostic: ${result.diagnostic}`
                : ''
              const preserved = partial.length === 0 ? '' : `\nPartial output before the run ended:\n${partial}`
              content.splice(0, content.length, { type: 'text', text: `${stopReasonHeadline(result.stopReason)}${diagnostic}${preserved}` })
            }
            return { content, isError: result.stopReason !== 'completed', meta: {
              kind: 'subagent', ...'remoteId' in result ? { externalChildId: result.id, remoteId: result.remoteId }
                : { childSessionId: result.id }, provider: result.provider, stopReason: result.stopReason,
            } }
          },
        },
        async execute(call) {
          const args = call.arguments as {
            description: string
            prompt: string
            run_in_background?: boolean
            provider?: string
            model?: string
            reasoning_effort?: string
          }
          if (args.description.length === 0 || args.prompt.length === 0) throw new Error('subagent: description and prompt must be nonempty')
          const options = selectedOptions(config, args)
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
            prompt: [{ type: 'text', text: args.prompt }], options,
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
