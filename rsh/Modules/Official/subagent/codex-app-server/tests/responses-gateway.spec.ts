import { expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import {
  type NativeExternalModelAttemptLease,
  type NativeExternalJsonValue,
  type NativeExternalSubagentModelOperations,
  type NativeExternalModelRoute,
  type NativeExternalToolCall,
  type NativeExternalToolCallGrant,
} from '@deepseek-ai/dsh-native-subagent/native'
import { createNativeResponsesGateway } from '../src/responses-gateway.ts'
import { createCodexDynamicToolCatalog } from '../src/dynamic-tools.ts'
import { NativeCodexToolBridge } from '../src/native-tool-bridge.ts'

const route: NativeExternalModelRoute = { provider: 'codex', model: 'fixture-model' }
const limits = { requestBytes: 16_384, responseBytes: 16_384, jsonDepth: 16, sseEvents: 16 }
const requestToken = 'fixture-only-token'

function parseObjectJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('fixture expected a JSON object')
  }
  return parsed as Record<string, unknown>
}

function fixtureModel(trace: string[] = [], toolExecution?: {
  readonly tools: NativeExternalSubagentModelOperations['tools']
  readonly executeTool: NativeExternalSubagentModelOperations['executeTool']
}) {
  // The private lease brand is minted only by Engine; this frozen lease stands in for its captured issuer.
  const lease = Object.freeze({ sequence: 1, signal: new AbortController().signal }) as unknown as NativeExternalModelAttemptLease
  const admitModelRequest = vi.fn<NativeExternalSubagentModelOperations['admitModelRequest']>(async (input) => {
    expect(input.route).toEqual(route)
    trace.push('admit')
    return lease
  })
  const recordModelResponse = vi.fn<NativeExternalSubagentModelOperations['recordModelResponse']>(async () => {
    trace.push('response')
    return []
  })
  const recordModelFailure = vi.fn<NativeExternalSubagentModelOperations['recordModelFailure']>(async () => { trace.push('failure') })
  const fatal = vi.fn<NativeExternalSubagentModelOperations['fatal']>()
  const model: NativeExternalSubagentModelOperations = {
    tools: toolExecution?.tools ?? { schemas: [], programSchemas: [], promptText: '' },
    admitModelRequest,
    recordModelResponse,
    recordModelFailure,
    executeTool: toolExecution?.executeTool ?? (async () => { throw new Error('unexpected model-only tool execution') }),
    fatal,
  }
  const toolBridge = new NativeCodexToolBridge(model, createCodexDynamicToolCatalog(model.tools))
  toolBridge.bindThread('fixture-thread')
  return { model, toolBridge, admitModelRequest, recordModelResponse, recordModelFailure, fatal }
}

it('keeps a trusted conclusion when Codex retries model admission before reporting the interrupt', async () => {
  const tools: NativeExternalSubagentModelOperations['tools'] = {
    schemas: [{ name: 'finish', description: 'finish the task', parameters: { type: 'object' } }],
    programSchemas: [],
    promptText: '',
  }
  const fixture = fixtureModel([], {
    tools,
    async executeTool() {
      return {
        result: { content: [{ type: 'text', text: 'done' }], isError: false },
        settlementContexts: [],
        concludesTurn: true,
        images: [],
      }
    },
  })
  const call: NativeExternalToolCall = { callId: ToolCallId('finish-call'), name: 'finish', arguments: {} }
  // The runtime-private grant brand is supplied by the Engine issuer in production.
  const grant = Object.freeze({ ...call }) as unknown as NativeExternalToolCallGrant
  fixture.toolBridge.bindTurn('fixture-turn')
  fixture.toolBridge.registerResponseGrants(1, [call], [grant])
  const params = {
    threadId: 'fixture-thread', turnId: 'fixture-turn', callId: 'finish-call', tool: 'finish', arguments: {},
  }
  const result = await fixture.toolBridge.executeCall(params, new AbortController().signal)
  expect(fixture.toolBridge.requestResultWritten('item/tool/call', params, result)).toMatchObject({
    threadId: 'fixture-thread', turnId: 'fixture-turn', result: { isError: false },
  })
  expect(fixture.toolBridge.trustedConclusionClosedModelAdmission).toBe(true)

  const forward = vi.fn()
  const gateway = createNativeResponsesGateway({
    route,
    model: fixture.model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    projectRequest: async body => body,
    signal: new AbortController().signal,
    forward,
  })

  const response = await gateway(request())
  expect(response.status).toBe(403)
  expect(fixture.admitModelRequest).not.toHaveBeenCalled()
  expect(fixture.recordModelFailure).not.toHaveBeenCalled()
  expect(forward).not.toHaveBeenCalled()
  expect(fixture.fatal).not.toHaveBeenCalled()
})

function request(): Request {
  return new Request('http://127.0.0.1/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${requestToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: route.model,
      stream: true,
      input: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'web_search' }],
      store: true,
    }),
  })
}

it.each([
  { label: 'over-cap', maxOutputTokens: 33 },
])('rejects a $label final token limit before admission, logging, or forwarding', async ({ maxOutputTokens }) => {
  const fixture = fixtureModel()
  const forward = vi.fn()
  const gateway = createNativeResponsesGateway({
    route,
    model: fixture.model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    maxOutputTokens: 32,
    projectRequest: async (body) => {
      const projected = parseObjectJson(JSON.stringify(body))
      projected.max_output_tokens = maxOutputTokens
      return projected as NativeExternalJsonValue
    },
    signal: new AbortController().signal,
    forward,
  })

  const response = await gateway(request())
  expect(response.status).toBe(403)
  expect(fixture.admitModelRequest).not.toHaveBeenCalled()
  expect(fixture.recordModelFailure).not.toHaveBeenCalled()
  expect(forward).not.toHaveBeenCalled()
})

it('rejects provider projection that rewrites the selected reasoning effort before admission', async () => {
  const fixture = fixtureModel()
  const forward = vi.fn()
  const gateway = createNativeResponsesGateway({
    route,
    model: fixture.model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    expectedReasoningEffort: 'high',
    projectRequest: async body => ({
      ...(body as { readonly [key: string]: NativeExternalJsonValue }),
      reasoning: { effort: 'medium' },
    }),
    signal: new AbortController().signal,
    forward,
  })

  const response = await gateway(request())
  expect(response.status).toBe(403)
  expect(fixture.admitModelRequest).not.toHaveBeenCalled()
  expect(fixture.recordModelFailure).not.toHaveBeenCalled()
  expect(forward).not.toHaveBeenCalled()
})

function sse(events: readonly Record<string, unknown>[]): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
}

function completed(output: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    type: 'response.completed',
    response: { id: 'resp-1', status: 'completed', output },
  }
}

it.each([
  { label: 'LF', ending: '\n\n' },
  { label: 'CRLF', ending: '\r\n\r\n' },
  { label: 'bare CR', ending: '\r\r' },
])('logs and completes a full response terminated by $label', async ({ ending }) => {
  const trace: string[] = []
  const fixture = fixtureModel(trace)
  const { model } = fixture
  const answer = completed([{ id: 'item-1', type: 'message', role: 'assistant', content: [] }])
  const upstreamBytes = new TextEncoder().encode(`data: ${JSON.stringify(answer)}${ending}`)
  const gateway = createNativeResponsesGateway({
    route,
    model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    projectRequest: async body => body,
    signal: new AbortController().signal,
    forward: vi.fn(async (body) => {
      trace.push('forward')
      expect(parseObjectJson(fixture.admitModelRequest.mock.calls[0]![0].requestBody)).toMatchObject({
        model: route.model,
        tools: [],
        tool_choice: 'none',
        parallel_tool_calls: false,
        store: false,
      })
      const logged = parseObjectJson(fixture.admitModelRequest.mock.calls[0]![0].requestBody)
      expect(logged.instructions).toContain('No tools are available')
      expect(body).toEqual(logged)
      return { status: 200, contentType: 'text/event-stream', body: new Response(upstreamBytes).body }
    }),
  })

  const response = await gateway(request())
  expect(response.status).toBe(200)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(upstreamBytes)
  expect(trace).toEqual(['admit', 'forward', 'response'])
  expect(fixture.recordModelResponse).toHaveBeenCalledOnce()
  expect(fixture.recordModelResponse.mock.calls[0]![1].toolCalls).toEqual([])
})

it('preserves an upstream HTTP failure when draining its body fails', async () => {
  const fixture = fixtureModel()
  const { model } = fixture
  const cleanupError = new Error('provider body cancellation failed')
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      throw cleanupError
    },
  })
  const gateway = createNativeResponsesGateway({
    route,
    model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    projectRequest: async body => body,
    signal: new AbortController().signal,
    forward: async () => ({ status: 429, contentType: 'application/json', body }),
  })

  const response = await gateway(request())

  expect(response.status).toBe(429)
  expect(fixture.recordModelFailure).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    kind: 'http',
    statusCode: 429,
    events: [],
  })
  expect(fixture.fatal).toHaveBeenCalledExactlyOnceWith(cleanupError)
  expect(fixture.recordModelResponse).not.toHaveBeenCalled()
})

it.each([
  {
    label: 'created-event response output',
    events: [
      { type: 'response.created', response: { id: 'resp-1', output: [{ type: 'web_search_call' }] } },
      completed([{ type: 'message', role: 'assistant', content: [] }]),
    ],
  },
  {
    label: 'completed response output',
    events: [completed([{ type: 'function_call', name: 'ungranted_tool', arguments: '{}' }])],
  },
])('rejects an unauthorized executable item in $label before exposing any upstream bytes', async ({ events }) => {
  const fixture = fixtureModel()
  const { model } = fixture
  const upstreamBytes = sse(events)
  const gateway = createNativeResponsesGateway({
    route,
    model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    projectRequest: async body => body,
    signal: new AbortController().signal,
    forward: async () => ({ status: 200, contentType: 'text/event-stream', body: new Response(upstreamBytes).body }),
  })

  const response = await gateway(request())
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('response.completed')
  expect(fixture.recordModelFailure).toHaveBeenCalledOnce()
  const failure = fixture.recordModelFailure.mock.calls[0]![1]
  expect(failure).toMatchObject({
    kind: 'policy',
    code: 'tool-not-authorized',
  })
  if (failure.kind === 'policy') expect(failure.completed).toBeDefined()
  expect(fixture.recordModelResponse).not.toHaveBeenCalled()
  expect(fixture.fatal).toHaveBeenCalledOnce()
})

it('records complete SSE events received before a transport interruption without forwarding the prefix', async () => {
  const fixture = fixtureModel()
  const { model } = fixture
  const created = { type: 'response.created', response: { id: 'resp-partial' } }
  let sent = false
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(sse([created]))
        return
      }
      controller.error(new Error('fixture connection reset'))
    },
  })
  const gateway = createNativeResponsesGateway({
    route,
    model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    projectRequest: async body => body,
    signal: new AbortController().signal,
    forward: async () => ({ status: 200, contentType: 'text/event-stream', body: source }),
  })

  const response = await gateway(request())
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('response.created')
  expect(fixture.recordModelFailure).toHaveBeenCalledOnce()
  expect(fixture.recordModelFailure.mock.calls[0]![1]).toMatchObject({
    kind: 'transport',
    events: [JSON.stringify(created)],
  })
  expect(fixture.recordModelResponse).not.toHaveBeenCalled()
})

it.each([
  { label: 'the abort reason', distinctCleanupFailure: false },
  { label: 'a separate cleanup failure', distinctCleanupFailure: true },
])('waits for upstream cancellation and keeps the received prefix when cancellation rejects with $label', async ({ distinctCleanupFailure }) => {
  const fixture = fixtureModel()
  const { model } = fixture
  const abortController = new AbortController()
  const abortReason = new Error('operation stopped')
  const cleanupError = distinctCleanupFailure ? new Error('reader cancellation failed') : abortReason
  const created = { type: 'response.created', response: { id: 'resp-aborted' } }
  let releaseCancellation!: (reason?: unknown) => void
  const cancellation = new Promise<void>((_resolve, reject) => { releaseCancellation = reject })
  let markCancellationStarted!: () => void
  const cancellationStarted = new Promise<void>((resolve) => { markCancellationStarted = resolve })
  let sent = false
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) return
      sent = true
      controller.enqueue(sse([created]))
      abortController.abort(abortReason)
    },
    cancel() {
      markCancellationStarted()
      return cancellation
    },
  }, { highWaterMark: 0 })
  const gateway = createNativeResponsesGateway({
    route,
    model,
    toolBridge: fixture.toolBridge,
    requestToken,
    limits,
    projectRequest: async body => body,
    signal: abortController.signal,
    forward: async () => ({ status: 200, contentType: 'text/event-stream', body: source }),
  })

  let settled = false
  const responsePromise = gateway(request()).finally(() => { settled = true })
  let response: Response
  try {
    await cancellationStarted
    expect(settled).toBe(false)
    releaseCancellation(cleanupError)
    response = await responsePromise
  } finally {
    releaseCancellation(abortReason)
  }

  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('response.created')
  expect(fixture.recordModelFailure).toHaveBeenCalledOnce()
  expect(fixture.recordModelFailure.mock.calls[0]![1]).toMatchObject({
    kind: 'transport',
    events: [JSON.stringify(created)],
  })
  expect(fixture.fatal).toHaveBeenCalledTimes(distinctCleanupFailure ? 1 : 0)
  if (distinctCleanupFailure) expect(fixture.fatal).toHaveBeenCalledWith(cleanupError)
  expect(fixture.recordModelResponse).not.toHaveBeenCalled()
})
