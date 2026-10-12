import { isDeepStrictEqual } from 'node:util'
import { serializeNativeExternalJson } from '@deepseek-ai/dsh-native-subagent'
import { normalizeWorkspacePaths } from './workspace-paths.mjs'

const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value
const serialize = value => serializeNativeExternalJson(value)

function toolInput(messages) {
  return messages.map(message => ({ role: 'user', content: message.content.map(block => {
    if (block.type !== 'text') throw new Error(`external-operation fixture cannot replay ${block.type} context`)
    return { type: 'input_text', text: block.text }
  }) }))
}

function resultText(content) {
  return content.map(block => {
    if (block.type !== 'text') throw new Error(`external-operation fixture cannot replay ${block.type} tool output`)
    return block.text
  }).join('\n')
}

function buildRequest(request, input, previousResponseId) {
  const prompt = request.prompt[0]
  if (request.prompt.length !== 1 || prompt?.type !== 'text') throw new Error('external-operation fixture expects one text child prompt')
  const tools = request.model.tools.schemas.map(tool => ({ type: 'function', name: tool.name,
    description: tool.description, parameters: tool.parameters }))
  return serialize({ model: request.route.model, instructions: request.model.tools.promptText, input, tools,
    ...previousResponseId === undefined ? {} : { previous_response_id: previousResponseId } })
}

function seededResponses() {
  const callArguments = { file_path: 'created.txt', content: 'written by the external child\n' }
  const completion = (id, output) => serialize({ type: 'response.completed', response: { id, output } })
  const writeResponse = completion('external-response-write', [{ type: 'function_call', id: 'external-write-item',
    call_id: 'external-write-call', name: 'write', arguments: JSON.stringify(callArguments) }])
  const finalResponse = completion('external-response-final', [])
  return [
    { kind: 'model-failure', failure: { kind: 'transport', events: [] } },
    { kind: 'model-response', events: [writeResponse], completed: writeResponse,
      toolCalls: [{ callId: 'external-write-call', name: 'write', arguments: callArguments }] },
    { kind: 'model-response', events: [finalResponse], completed: finalResponse, toolCalls: [] },
  ]
}

async function execute(request, signal, operationScript, recordedChildOutput) {
  const route = { provider: request.route.provider, model: request.route.model }
  const first = request.prompt[0]
  if (first?.type !== 'text') throw new Error('external-operation fixture prompt is not text')
  let input = [{ role: 'user', content: [{ type: 'input_text', text: first.text }] }]
  let previousResponseId
  let lastSettlement
  let lastCall
  let terminalOutput
  const recorded = operationScript
  const plans = recorded === undefined ? seededResponses() : recorded.filter(event =>
    event.kind === 'model-failure' || event.kind === 'model-response')
  const requests = recorded?.filter(event => event.kind === 'model-request')
  if (recorded !== undefined && (requests?.length !== plans.length || plans.length !== 3)) {
    throw new Error('external-operation fixture must contain all three recorded attempts')
  }

  for (let index = 0; index < plans.length; index++) {
    if (signal.aborted) throw signal.reason
    const plan = plans[index]
    if (plan === undefined) throw new Error(`external-operation fixture omitted attempt ${index + 1}`)
    const sequence = plan.sequence ?? index + 1
    const requestBody = buildRequest(request, input, previousResponseId)
    const expectedRequest = requests?.find(event => event.sequence === sequence)
    if (recorded !== undefined && (expectedRequest === undefined
      || !isDeepStrictEqual(JSON.parse(expectedRequest.requestBody),
        normalizeWorkspacePaths(JSON.parse(requestBody), request.cwd)))) {
      throw new Error(`external-operation replay request ${sequence} differs from its persisted request`)
    }
    const lease = await request.model.admitModelRequest({ route, requestBody })
    if (plan.kind === 'model-failure') {
      await request.model.recordModelFailure(lease, plan.failure)
      continue
    }

    const response = { events: plan.events, completed: plan.completed, toolCalls: plan.toolCalls }
    const grants = await request.model.recordModelResponse(lease, response)
    if (grants.length !== plan.toolCalls.length) throw new Error(`external-operation attempt ${sequence} grant count changed`)
    if (grants.length === 0) {
      if (sequence !== plans.length) throw new Error('external-operation completed before all recorded attempts')
      const completed = parseJson(plan.completed)
      const responseId = completed?.response?.id
      if (typeof responseId !== 'string') throw new Error('external-operation final response omitted its id')
      terminalOutput = recordedChildOutput ?? [{ type: 'text', text: 'Child wrote created.txt.' }]
      continue
    }

    if (grants.length !== 1) throw new Error('external-operation fixture expects one filesystem call')
    const grant = grants[0]
    if (grant === undefined) throw new Error('external-operation fixture lost its filesystem grant')
    const call = plan.toolCalls[0]
    if (call === undefined || call.name !== 'write' || grant.callId !== call.callId || grant.name !== call.name) {
      throw new Error('external-operation replay tool grant differs from its recorded call')
    }
    lastCall = { callId: grant.callId, name: grant.name, arguments: call.arguments }
    lastSettlement = await request.model.executeTool(grant, signal)
    const expectedToolCall = recorded?.find(event => event.kind === 'tool-call' && event.modelSequence === sequence)
    const expectedToolResult = recorded?.find(event => event.kind === 'tool-result' && event.modelSequence === sequence)
    const expectedSettlement = recorded?.find(event => event.kind === 'tool-settlement' && event.modelSequence === sequence)
    if (recorded !== undefined && (!isDeepStrictEqual(expectedToolCall && {
      callId: expectedToolCall.callId, name: expectedToolCall.name, arguments: expectedToolCall.arguments,
    }, lastCall) || !isDeepStrictEqual(expectedToolResult?.result,
      normalizeWorkspacePaths(lastSettlement.result, request.cwd))
      || !isDeepStrictEqual(expectedSettlement && {
        settlementContexts: expectedSettlement.settlementContexts, concludesTurn: expectedSettlement.concludesTurn,
      }, { settlementContexts: lastSettlement.settlementContexts, concludesTurn: lastSettlement.concludesTurn }))) {
      throw new Error(`external-operation replay settlement ${sequence} differs from its persisted facts`)
    }
    if (lastSettlement.concludesTurn) throw new Error('external-operation filesystem settlement unexpectedly ended the turn')
    const completed = parseJson(plan.completed)
    const responseId = completed?.response?.id
    if (typeof responseId !== 'string') throw new Error(`external-operation response ${sequence} omitted its id`)
    previousResponseId = responseId
    const contexts = [...lastSettlement.result.additionalContexts ?? [], ...lastSettlement.settlementContexts]
    input = [
      { type: 'function_call_output', call_id: grant.callId, output: resultText(lastSettlement.result.content) },
      ...toolInput(contexts),
    ]
  }

  if (lastCall === undefined || lastSettlement === undefined || terminalOutput === undefined) {
    throw new Error('external-operation fixture did not complete its write and final response')
  }
  return { output: terminalOutput, stopReason: 'completed' }
}

export const plugin = {
  apiVersion: 1,
  name: 'native-external-operation-driver',
  targets: ['host'],
  requires: [],
  provides: ['externalSubagentDriver'],
  resolve: input => context => context.provide('externalSubagentDriver', {
    name: 'external-fixture',
    routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    async start(request, signal) {
      const result = new Promise((resolve, reject) => {
        setImmediate(() => { void execute(request, signal, input.operationScript, input.childOutput).then(resolve, reject) })
      })
      return { remoteId: 'external-operation-fixture', result, async dispose() { await result } }
    },
  }),
}
