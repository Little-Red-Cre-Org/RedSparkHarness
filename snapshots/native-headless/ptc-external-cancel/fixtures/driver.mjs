import { appendFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { serializeNativeExternalJson } from '@deepseek-ai/dsh-native-subagent'
import { normalizeWorkspacePaths } from './workspace-paths.mjs'

function operationGroups(events) {
  const ids = [...new Set(events.filter(event => event.kind === 'model-request').map(event => event.id))]
  return ids.map(id => events.filter(event => event.id === id))
}

function recordedOperation(events, ordinal) {
  const selected = operationGroups(events)[ordinal - 1]
  if (selected === undefined) throw new Error(`ptc-external-cancel: canonical Session omitted child ${ordinal}`)
  return selected
}

function buildRequest(request) {
  const prompt = request.prompt
  const input = prompt.map(block => {
    if (block.type !== 'text') throw new Error(`ptc-external-cancel: unsupported prompt block ${block.type}`)
    return { type: 'input_text', text: block.text }
  })
  if (input.length !== 1) throw new Error('ptc-external-cancel: expected one text child prompt')
  return {
    model: request.route.model,
    instructions: request.model.tools.promptText,
    input: [{ role: 'user', content: input }],
    tools: request.model.tools.schemas.map(tool => ({ type: 'function', name: tool.name,
      description: tool.description, parameters: tool.parameters })),
  }
}

function responseFromBody(body) {
  const call = body.output?.[0]
  if (body.output?.length !== 1 || call?.type !== 'function_call' || call.name !== 'run_code'
    || typeof call.call_id !== 'string' || typeof call.arguments !== 'string') {
    throw new Error('ptc-external-cancel: forwarded Responses body omitted the expected run_code call')
  }
  const argumentsValue = JSON.parse(call.arguments)
  if (argumentsValue === null || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    throw new Error('ptc-external-cancel: run_code call arguments were not an object')
  }
  const serialized = serializeNativeExternalJson({ type: 'response.completed', response: body })
  return { completed: serialized, events: [serialized], toolCalls: [{ callId: call.call_id,
    name: call.name, arguments: argumentsValue }] }
}

async function run(request, signal, events, ordinal, audit) {
  const responses = request.responses
  if (responses === undefined) throw new Error('ptc-external-cancel: Engine did not pass a captured Responses generation')
  const route = { provider: request.route.provider, model: request.route.model }
  const projected = await responses.projectRequest(buildRequest(request), signal)
  const requestBody = serializeNativeExternalJson(projected)
  const operation = events === undefined ? undefined : recordedOperation(events, ordinal)
  const expectedRequest = operation?.find(event => event.kind === 'model-request' && event.sequence === 1)
  if (events !== undefined && (expectedRequest === undefined || !isDeepStrictEqual(
    normalizeWorkspacePaths(JSON.parse(expectedRequest.requestBody), request.cwd),
    normalizeWorkspacePaths(JSON.parse(requestBody), request.cwd),
  ))) {
    throw new Error(`ptc-external-cancel: live projected request differs from canonical child ${ordinal}`)
  }
  const lease = await request.model.admitModelRequest({ route, requestBody })
  let forwarded
  try {
    forwarded = await responses.forward(projected, signal)
  } catch (error) {
    if (!signal.aborted || error !== signal.reason) throw error
    const failure = operation?.find(event => event.kind === 'model-failure' && event.sequence === 1)
    if (events !== undefined && failure === undefined) {
      throw new Error(`ptc-external-cancel: canonical child ${ordinal} omitted its cancellation failure`)
    }
    await request.model.recordModelFailure(lease, failure?.failure ?? { kind: 'transport', events: [] })
    return { output: [], stopReason: 'aborted' }
  }
  if (ordinal !== 1 || forwarded.body === null) {
    throw new Error(`ptc-external-cancel: unexpected successful Responses operation ${ordinal}`)
  }
  const body = JSON.parse(await new Response(forwarded.body).text())
  const expectedResponse = operation?.find(event => event.kind === 'model-response' && event.sequence === 1)
  if (events !== undefined && expectedResponse === undefined) {
    throw new Error('ptc-external-cancel: canonical outer child omitted its Responses result')
  }
  const response = responseFromBody(body)
  if (expectedResponse !== undefined && !isDeepStrictEqual(response, {
    completed: expectedResponse.completed, events: expectedResponse.events, toolCalls: expectedResponse.toolCalls,
  })) {
    throw new Error('ptc-external-cancel: live body-derived response differs from canonical facts')
  }
  const grants = await request.model.recordModelResponse(lease, response)
  if (grants.length !== 1 || response.toolCalls.length !== 1 || response.toolCalls[0]?.name !== 'run_code') {
    throw new Error('ptc-external-cancel: expected one PTC run_code grant')
  }
  try {
    await request.model.executeTool(grants[0], signal)
  } catch (error) {
    if (!signal.aborted || error !== signal.reason) throw error
  }
  return { output: [], stopReason: signal.aborted ? 'aborted' : 'completed' }
}

export const plugin = {
  apiVersion: 1,
  name: 'native-ptc-cancel-driver',
  targets: ['host'],
  requires: [],
  provides: ['externalSubagentDriver'],
  resolve: input => context => {
    let nextOperation = 0
    context.provide('externalSubagentDriver', {
      name: 'ptc-cancel-fixture',
      modelProtocol: 'responses',
      routeFields: [],
      capabilities: { persona: false, toolFilter: false, outputSchema: false },
      start(request, signal) {
        const ordinal = ++nextOperation
        const result = new Promise((resolve, reject) => {
          setImmediate(() => { void run(request, signal, input.operationScript, ordinal, input.audit).then(resolve, reject) })
        })
        void result.catch(() => {})
        return Promise.resolve({
          remoteId: `ptc-cancel-${ordinal}`,
          result,
          async dispose() {
            appendFileSync(input.audit, `product-dispose-start:${ordinal}\n`)
            await result.then(() => undefined, () => undefined)
            appendFileSync(input.audit, `product-dispose-end:${ordinal}\n`)
          },
        })
      },
    })
  },
}
