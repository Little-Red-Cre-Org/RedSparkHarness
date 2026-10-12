import { createParser } from 'eventsource-parser'
import { serializeNativeExternalJson } from '@deepseek-ai/dsh-native-subagent/native'
import type { NativeResponsesTransportResponse } from '@deepseek-ai/dsh-native-model-execution/responses-transport'
import type {
  NativeExternalJsonValue,
  NativeExternalModelFailure,
  NativeExternalModelRoute,
  NativeExternalSubagentModelOperations,
  NativeExternalToolCall,
} from '@deepseek-ai/dsh-native-subagent/native'
import { parseCodexResponsesToolCalls } from './dynamic-tools.ts'
import type { CodexDynamicToolCatalog } from './dynamic-tools.ts'
import type { NativeCodexToolBridge } from './native-tool-bridge.ts'
export type { NativeResponsesTransportResponse } from '@deepseek-ai/dsh-native-model-execution/responses-transport'

const RESPONSE_PATH = '/v1/responses'
const SAFE_EVENTS = new Set([
  'codex.response.metadata',
  'response.content_part.added',
  'response.content_part.done',
  'response.created',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.in_progress',
  'response.metadata',
  'response.output_item.added',
  'response.output_item.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.reasoning_text.delta',
  'responsesapi.websocket_timing',
])
const TOOL_ITEMS = new Set([
  'computer_call',
  'custom_tool_call',
  'file_search_call',
  'function_call',
  'image_generation_call',
  'local_shell_call',
  'mcp_call',
  'web_search_call',
])
const NO_TOOL_INSTRUCTION = 'No tools are available for this request. Answer from the supplied input without calling tools.'

/** Deployment-resolved byte, JSON, and stream-event ceilings for one gateway run. */
export interface NativeResponsesGatewayLimits {
  readonly requestBytes: number
  readonly responseBytes: number
  readonly jsonDepth: number
  readonly sseEvents: number
}
/** Forward one already-sanitized Responses body through the operation's selected provider. */
export type NativeResponsesForward = (
  body: NativeExternalJsonValue,
  signal: AbortSignal,
) => Promise<NativeResponsesTransportResponse>

/** Apply the captured provider's model and image policy to one complete request body. */
export type NativeResponsesProjectRequest = (
  body: NativeExternalJsonValue,
  signal: AbortSignal,
) => Promise<NativeExternalJsonValue>

/** Inputs captured for one Native operation; this adapter never resolves routes or credentials. */
export interface NativeResponsesGatewayOptions {
  readonly route: NativeExternalModelRoute
  readonly model: NativeExternalSubagentModelOperations
  readonly toolBridge: NativeCodexToolBridge
  readonly forward: NativeResponsesForward
  readonly projectRequest: NativeResponsesProjectRequest
  /** Parent-owned response-token ceiling for the final projected request. */
  readonly maxOutputTokens?: number
  /** Explicit Engine-selected reasoning effort required in the final projected request. */
  readonly expectedReasoningEffort?: string
  /** Per-run token accepted only from the local product process; never retained in the operation log. */
  readonly requestToken: string
  /** Deployment-resolved resource ceilings; this adapter does not choose their values. */
  readonly limits: NativeResponsesGatewayLimits
  readonly signal: AbortSignal
}

interface ParsedResponseStream {
  readonly events: readonly NativeExternalJsonValue[]
  readonly completed?: NativeExternalJsonValue
  readonly terminalFailure?: NativeExternalJsonValue
  readonly failure?: GatewayFailure
}

type GatewayFailureReason =
  | { readonly kind: 'protocol'; readonly code: 'invalid-sse' | 'invalid-response' | 'unsupported-item' }
  | { readonly kind: 'policy'; readonly code: 'tool-not-authorized' | 'route-mismatch' | 'policy-rejected' }

class GatewayBodyReadFailure extends Error {
  constructor(
    readonly bytes: Uint8Array,
    readonly sizeExceeded: boolean,
    readonly cancellationError?: unknown,
  ) {
    super('Responses body could not be read completely')
  }
}

class GatewayFailure extends Error {
  constructor(
    message: string,
    readonly reason: GatewayFailureReason,
    readonly events: readonly NativeExternalJsonValue[],
    readonly completed?: NativeExternalJsonValue,
  ) {
    super(message)
  }
}

class UnauthorizedGatewayRequest extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertJsonValue(value: unknown, maxDepth: number): NativeExternalJsonValue {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    const item = current.value
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('JSON numbers must be finite')
      continue
    }
    if (current.depth >= maxDepth) throw new TypeError('JSON nesting exceeds the supported limit')
    if (Array.isArray(item)) {
      for (const child of item) pending.push({ value: child, depth: current.depth + 1 })
      continue
    }
    if (!isRecord(item) || Object.getPrototypeOf(item) !== Object.prototype) {
      throw new TypeError('value is not a JSON document')
    }
    for (const child of Object.values(item)) pending.push({ value: child, depth: current.depth + 1 })
  }
  return value as NativeExternalJsonValue
}

async function readBytes(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
  preservePrefix = false,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let sizeExceeded = false
  let cancellation: Promise<void> | undefined
  let cancellationReason: unknown
  let cancellationError: unknown
  const cancelReader = (reason?: unknown): Promise<void> => cancellation ??= (() => {
    cancellationReason = reason
    return reader.cancel(reason).catch((error: unknown) => { cancellationError = error })
  })()
  const cancelOnAbort = (): void => { void cancelReader(signal.reason) }
  signal.addEventListener('abort', cancelOnAbort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) {
        signal.throwIfAborted()
        break
      }
      if (length + value.byteLength > limit) {
        sizeExceeded = true
        const remaining = limit - length
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining))
          length = limit
        }
        await cancelReader(new RangeError('Responses body exceeds the supported size limit'))
        throw new RangeError('Responses body exceeds the supported size limit')
      }
      length += value.byteLength
      chunks.push(value)
      signal.throwIfAborted()
    }
  } catch (error: unknown) {
    await cancelReader(error)
    const distinctCancellationError = cancellationError === cancellationReason ? undefined : cancellationError
    if (preservePrefix) {
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      throw new GatewayBodyReadFailure(bytes, sizeExceeded, distinctCancellationError)
    }
    if (distinctCancellationError !== undefined) {
      throw distinctCancellationError instanceof Error
        ? distinctCancellationError
        : new Error('Responses body cancellation failed', { cause: distinctCancellationError })
    }
    throw error
  } finally {
    signal.removeEventListener('abort', cancelOnAbort)
    await cancellation
    reader.releaseLock()
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function requestJson(
  request: Request,
  signal: AbortSignal,
  requestToken: string,
  limits: NativeResponsesGatewayLimits,
): Promise<Record<string, unknown>> {
  if (request.headers.get('authorization') !== `Bearer ${requestToken}`) {
    throw new UnauthorizedGatewayRequest('Responses request did not authenticate as the captured product process')
  }
  if (request.method !== 'POST') throw new GatewayFailure('Responses requires POST', { kind: 'protocol', code: 'invalid-response' }, [])
  const url = new URL(request.url)
  if (url.pathname !== RESPONSE_PATH || url.search !== '') {
    throw new GatewayFailure('only the Responses route is supported', { kind: 'policy', code: 'policy-rejected' }, [])
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new GatewayFailure('Responses requires an application/json body', { kind: 'protocol', code: 'invalid-response' }, [])
  }
  let bytes: Uint8Array
  try {
    bytes = await readBytes(request.body, limits.requestBytes, signal)
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      throw new GatewayFailure('Responses request exceeds the supported size limit', { kind: 'protocol', code: 'invalid-response' }, [])
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new GatewayFailure('Responses request is not valid UTF-8 JSON', { kind: 'protocol', code: 'invalid-response' }, [])
  }
  if (!isRecord(parsed)) throw new GatewayFailure('Responses request must be a JSON object', { kind: 'protocol', code: 'invalid-response' }, [])
  assertJsonValue(parsed, limits.jsonDepth)
  return parsed
}

function sanitizeRequest(
  body: Record<string, unknown>,
  route: NativeExternalModelRoute,
  limits: NativeResponsesGatewayLimits,
  catalog: CodexDynamicToolCatalog,
  settlementInput: readonly NativeExternalJsonValue[],
): NativeExternalJsonValue {
  if (body.model !== route.model) {
    throw new GatewayFailure('Responses model does not match the captured route', { kind: 'policy', code: 'route-mismatch' }, [])
  }
  if (body.stream !== true || !('input' in body)) {
    throw new GatewayFailure('Responses requires a complete streaming input', { kind: 'policy', code: 'policy-rejected' }, [])
  }
  for (const field of ['conversation', 'previous_response_id', 'prompt']) {
    if (field in body) throw new GatewayFailure(`Responses field ${field} is not self-contained`, { kind: 'policy', code: 'policy-rejected' }, [])
  }
  if (body.background === true) {
    throw new GatewayFailure('background Responses are not supported', { kind: 'policy', code: 'policy-rejected' }, [])
  }
  if ('instructions' in body && typeof body.instructions !== 'string') {
    throw new GatewayFailure('Responses instructions must be a string', { kind: 'protocol', code: 'invalid-response' }, [])
  }
  if ('tools' in body && !Array.isArray(body.tools)) {
    throw new GatewayFailure('Responses tools must be an array', { kind: 'protocol', code: 'invalid-response' }, [])
  }
  const input = body.input
  let inputItems: NativeExternalJsonValue[]
  if (typeof input === 'string') {
    inputItems = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] }]
  } else if (Array.isArray(input)) {
    inputItems = input.map((item: unknown) => assertJsonValue(item, limits.jsonDepth))
  } else {
    throw new GatewayFailure('Responses input must be a string or message array', { kind: 'protocol', code: 'invalid-response' }, [])
  }
  const instructions = [body.instructions, catalog.promptText,
    ...(catalog.responsesTools.length === 0 ? [NO_TOOL_INSTRUCTION] : [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n')
  return assertJsonValue({
    ...body,
    input: [...inputItems, ...settlementInput],
    instructions,
    background: false,
    store: false,
    tools: catalog.responsesTools,
    tool_choice: catalog.responsesTools.length === 0 ? 'none' : 'auto',
    parallel_tool_calls: false,
  }, limits.jsonDepth)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
}

function validateProjectedRequest(
  value: NativeExternalJsonValue,
  route: NativeExternalModelRoute,
  catalog: CodexDynamicToolCatalog,
  limits: NativeResponsesGatewayLimits,
  maxOutputTokens?: number,
  expectedReasoningEffort?: string,
): NativeExternalJsonValue {
  if (!isRecord(value) || value.model !== route.model || value.stream !== true || !('input' in value)
    || value.background !== false || value.store !== false
    || value.tool_choice !== (catalog.responsesTools.length === 0 ? 'none' : 'auto')
    || value.parallel_tool_calls !== false || !jsonEqual(value.tools, catalog.responsesTools)) {
    throw new GatewayFailure('Captured provider projection changed the selected route or authorized tools', {
      kind: 'policy', code: 'policy-rejected',
    }, [])
  }
  for (const field of ['conversation', 'previous_response_id', 'prompt']) {
    if (field in value) throw new GatewayFailure(`Responses field ${field} is not self-contained`, { kind: 'policy', code: 'policy-rejected' }, [])
  }
  if (typeof value.instructions !== 'string') {
    throw new GatewayFailure('Responses instructions must be a complete string', { kind: 'protocol', code: 'invalid-response' }, [])
  }
  if (expectedReasoningEffort !== undefined
    && (!isRecord(value.reasoning) || value.reasoning.effort !== expectedReasoningEffort)) {
    throw new GatewayFailure('Projected Responses reasoning effort does not match the selected route', {
      kind: 'policy', code: 'policy-rejected',
    }, [])
  }
  if (maxOutputTokens !== undefined && (typeof value.max_output_tokens !== 'number'
    || !Number.isSafeInteger(value.max_output_tokens)
    || value.max_output_tokens <= 0
    || value.max_output_tokens > maxOutputTokens)) {
    throw new GatewayFailure('Responses max_output_tokens must be a positive safe integer within the parent limit', {
      kind: 'policy', code: 'policy-rejected',
    }, [])
  }
  const projected = assertJsonValue(value, limits.jsonDepth)
  if (new TextEncoder().encode(JSON.stringify(projected)).byteLength > limits.requestBytes) {
    throw new GatewayFailure('Projected Responses request exceeds the supported size limit', { kind: 'protocol', code: 'invalid-response' }, [])
  }
  return projected
}

function parseSse(
  text: string,
  limits: NativeResponsesGatewayLimits,
  catalog: CodexDynamicToolCatalog,
  requireTerminal = true,
): ParsedResponseStream {
  const events: NativeExternalJsonValue[] = []
  const functionItemIds = new Set<string>()
  let completed: NativeExternalJsonValue | undefined
  let terminalFailure: NativeExternalJsonValue | undefined
  let terminalSeen = false
  let doneSeen = false
  let failure: { readonly message: string; readonly reason: GatewayFailureReason } | undefined
  const fail = (
    message: string,
    reason: GatewayFailureReason = { kind: 'protocol', code: 'invalid-sse' },
  ): void => { failure ??= { message, reason } }

  const parser = createParser({
    maxBufferSize: limits.responseBytes,
    onError: () => { fail('Responses SSE contains an unsupported or malformed field') },
    onEvent: ({ data, event: eventName }) => {
      if (events.length >= limits.sseEvents) {
        fail('Responses SSE contains too many events')
        return
      }
      if (data === '[DONE]') {
        if (!terminalSeen || doneSeen || eventName !== undefined) fail('Responses SSE has an invalid done marker')
        doneSeen = true
        return
      }
      if (terminalSeen) fail('SSE data followed a terminal Responses event')
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        fail('Responses SSE data is not valid JSON')
        return
      }
      if (!isRecord(parsed)) {
        fail('Responses SSE data must be an object')
        return
      }
      let event: NativeExternalJsonValue
      try {
        event = assertJsonValue(parsed, limits.jsonDepth)
      } catch {
        fail('Responses SSE data is not a supported JSON document')
        return
      }
      const type = parsed.type
      events.push(event)
      if (typeof type !== 'string' || (eventName !== undefined && eventName !== type)) {
        fail('Responses SSE event type is missing or inconsistent')
      }
      if (typeof type !== 'string') return
      if (type === 'response.custom_tool_call_input.delta' || type === 'response.custom_tool_call_input.done') {
        fail('Responses returned a tool-call event without an Engine tool grant', { kind: 'policy', code: 'tool-not-authorized' })
      }
      if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
        if (catalog.responsesTools.length === 0) {
          fail('Responses returned a function-call event without an Engine tool grant', { kind: 'policy', code: 'tool-not-authorized' })
        } else if (typeof parsed.item_id !== 'string' || !functionItemIds.has(parsed.item_id)) {
          fail('Responses function-call event does not reference an advertised function item')
        } else if (type.endsWith('.delta') ? typeof parsed.delta !== 'string' : typeof parsed.arguments !== 'string') {
          fail('Responses function-call arguments event is malformed')
        }
      }
      if (type === 'error' || type === 'response.failed' || type === 'response.incomplete') {
        const response = parsed.response
        if (type !== 'error' && !isRecord(response)) {
          fail('Responses terminal failure is missing its response object', { kind: 'protocol', code: 'invalid-response' })
        }
        terminalFailure ??= event
        terminalSeen = true
        return
      }
      if (type === 'response.completed') {
        const response = parsed.response
        if (!isRecord(response) || response.status !== 'completed' || typeof response.id !== 'string'
          || !Array.isArray(response.output)) {
          fail('Responses completion is malformed or non-completed', { kind: 'protocol', code: 'invalid-response' })
        }
        if (isRecord(response) && Array.isArray(response.output)) {
          for (const item of response.output) {
            try {
              assertSafeOutputItem(item, events, catalog, functionItemIds)
            } catch (error: unknown) {
              if (error instanceof GatewayFailure) fail(error.message, error.reason)
              else throw error
            }
          }
        }
        completed ??= event
        terminalSeen = true
        return
      }
      if (isRecord(parsed.response)) {
        try {
          assertSafeResponseOutput(parsed.response, events, catalog, functionItemIds)
        } catch (error: unknown) {
          if (error instanceof GatewayFailure) fail(error.message, error.reason)
          else throw error
        }
      }
      if (terminalSeen) return
      if (!SAFE_EVENTS.has(type)) {
        fail('Responses emitted an unsupported event')
      }
      if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        try {
          assertSafeOutputItem(parsed.item, events, catalog, functionItemIds)
        } catch (error: unknown) {
          if (error instanceof GatewayFailure) fail(error.message, error.reason)
          else throw error
        }
      }
      if (type === 'response.created' && (!isRecord(parsed.response) || typeof parsed.response.id !== 'string')) {
        fail('Responses created event is malformed', { kind: 'protocol', code: 'invalid-response' })
      }
      if (type === 'response.content_part.added' || type === 'response.content_part.done') {
        if (!isRecord(parsed.part) || typeof parsed.item_id !== 'string' || typeof parsed.content_index !== 'number') {
          fail('Responses content-part event is malformed', { kind: 'protocol', code: 'invalid-response' })
        }
      }
      if (type === 'response.output_text.delta' && typeof parsed.delta !== 'string') {
        fail('Responses output-text delta is malformed', { kind: 'protocol', code: 'invalid-response' })
      }
      if (type === 'response.output_text.done' && typeof parsed.text !== 'string') {
        fail('Responses output-text completion is malformed', { kind: 'protocol', code: 'invalid-response' })
      }
      if (type === 'response.reasoning_summary_text.delta'
        && (typeof parsed.delta !== 'string' || typeof parsed.summary_index !== 'number')) {
        fail('Responses reasoning-summary delta is malformed', { kind: 'protocol', code: 'invalid-response' })
      }
      if (type === 'response.reasoning_summary_text.done'
        && (typeof parsed.text !== 'string' || typeof parsed.summary_index !== 'number' || typeof parsed.item_id !== 'string')) {
        fail('Responses reasoning-summary completion is malformed', { kind: 'protocol', code: 'invalid-response' })
      }
      if (type === 'response.reasoning_text.delta'
        && (typeof parsed.delta !== 'string' || typeof parsed.content_index !== 'number')) {
        fail('Responses reasoning delta is malformed', { kind: 'protocol', code: 'invalid-response' })
      }
      if ((type === 'response.reasoning_summary_part.added' || type === 'response.reasoning_summary_part.done')
        && typeof parsed.summary_index !== 'number') {
        fail('Responses reasoning-summary part is malformed', { kind: 'protocol', code: 'invalid-response' })
      }
    },
  })
  try {
    parser.feed(text)
    if (text.endsWith('\r')) parser.feed('\n')
  } catch {
    fail('Responses SSE parser rejected the stream')
  }
  if (requireTerminal && completed === undefined && terminalFailure === undefined && failure === undefined) {
    fail('Responses stream ended before a terminal event')
  }
  return {
    events,
    ...(completed === undefined ? {} : { completed }),
    ...(terminalFailure === undefined ? {} : { terminalFailure }),
    ...(failure === undefined ? {} : {
      failure: new GatewayFailure(failure.message, failure.reason, events, completed),
    }),
  }
}

function assertSafeResponseOutput(
  response: Record<string, unknown>,
  events: readonly NativeExternalJsonValue[],
  catalog: CodexDynamicToolCatalog,
  functionItemIds: Set<string>,
): void {
  if (!('output' in response)) return
  if (!Array.isArray(response.output)) {
    throw new GatewayFailure('Responses output is malformed', { kind: 'protocol', code: 'invalid-response' }, events)
  }
  for (const item of response.output) assertSafeOutputItem(item, events, catalog, functionItemIds)
}

function assertSafeOutputItem(
  value: unknown,
  events: readonly NativeExternalJsonValue[],
  catalog: CodexDynamicToolCatalog,
  functionItemIds: Set<string>,
): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new GatewayFailure('Responses output item is malformed', { kind: 'protocol', code: 'invalid-response' }, events)
  }
  if (value.type === 'function_call') {
    if (catalog.responsesTools.length === 0 || typeof value.name !== 'string'
      || catalog.namespaceFor(value.name) === undefined
      || (value.namespace !== undefined && value.namespace !== null)) {
      throw new GatewayFailure('Responses returned an unadvertised function call', { kind: 'policy', code: 'tool-not-authorized' }, events)
    }
    if (typeof value.id === 'string') functionItemIds.add(value.id)
    return
  }
  if (TOOL_ITEMS.has(value.type)) {
    throw new GatewayFailure('Responses returned an executable item without an Engine tool grant', { kind: 'policy', code: 'tool-not-authorized' }, events)
  }
  if (value.type !== 'message' && value.type !== 'reasoning') {
    throw new GatewayFailure('Responses output item type is unsupported', { kind: 'protocol', code: 'unsupported-item' }, events)
  }
  if (value.type === 'message' && (value.role !== 'assistant' || !Array.isArray(value.content))) {
    throw new GatewayFailure('Responses message is malformed or not assistant-authored', { kind: 'protocol', code: 'invalid-response' }, events)
  }
}

function nativeFailure(failure: GatewayFailure): NativeExternalModelFailure {
  const events = failure.events.map(event => serializeNativeExternalJson(event))
  const completed = failure.completed === undefined
    ? {}
    : { completed: serializeNativeExternalJson(failure.completed) }
  return { ...failure.reason, events, ...completed }
}

function jsonError(status: number, message: string): Response {
  const responseStatus = status >= 400 && status <= 599 ? status : 502
  return Response.json({ error: { message, type: 'api_error' } }, { status: responseStatus })
}

/** Create a buffered, fail-closed Responses adapter for one captured Native operation.
 * @param options - The selected Engine route, operation log, provider callback, and cancellation signal.
 * @returns A handler that only accepts one complete `/v1/responses` JSON/SSE exchange at a time.
 */
export function createNativeResponsesGateway(
  options: NativeResponsesGatewayOptions,
): (request: Request) => Promise<Response> {
  const catalog = options.toolBridge.catalog
  let fatalError: Error | undefined
  let fatalNotified = false
  const hasFatalError = (): boolean => fatalError !== undefined
  const blockAdmission = (error: Error): void => { fatalError ??= error }
  const fatal = (error: Error): void => {
    if (fatalNotified) return
    fatalError = error
    fatalNotified = true
    try {
      options.model.fatal(error)
    } catch {
      // Engine fatal notification owns cancellation; this adapter still closes the HTTP exchange.
    }
  }
  const handler = async (request: Request): Promise<Response> => {
    if (hasFatalError()) return jsonError(403, 'Native model operation is no longer available.')
    const requestSignal = AbortSignal.any([options.signal, request.signal])
    let lease: Awaited<ReturnType<NativeExternalSubagentModelOperations['admitModelRequest']>> | undefined
    let contextReservation: ReturnType<NativeCodexToolBridge['reserveContexts']> | undefined
    let contextsCommitted = false
    const settlement = { started: false, finished: false }
    const settleFailure = async (failure: NativeExternalModelFailure): Promise<void> => {
      if (lease === undefined) throw new Error('gateway cannot settle a request before Engine admission')
      settlement.started = true
      try {
        await options.model.recordModelFailure(lease, failure)
        settlement.finished = true
      } catch (error: unknown) {
        fatal(error instanceof Error ? error : new Error('Engine failed to record the model attempt'))
        throw error
      }
    }
    const cancelBody = async (body: ReadableStream<Uint8Array> | null): Promise<unknown> => {
      try {
        await body?.cancel()
        return undefined
      } catch (error: unknown) {
        return error
      }
    }
    try {
      requestSignal.throwIfAborted()
      if (!options.toolBridge.modelAdmissionOpen) {
        if (options.toolBridge.trustedConclusionClosedModelAdmission) {
          return jsonError(403, 'Native model operation was stopped.')
        }
        throw new GatewayFailure('Native tool completion closed further model admission', {
          kind: 'policy', code: 'policy-rejected',
        }, [])
      }
      const parsed = await requestJson(request, requestSignal, options.requestToken, options.limits)
      contextReservation = options.toolBridge.reserveContexts()
      const body = sanitizeRequest(
        parsed,
        options.route,
        options.limits,
        catalog,
        options.toolBridge.projectContexts(contextReservation),
      )
      const projectedBody = await options.projectRequest(body, requestSignal)
      const finalBody = validateProjectedRequest(
        projectedBody,
        options.route,
        catalog,
        options.limits,
        options.maxOutputTokens,
        options.expectedReasoningEffort,
      )
      lease = await options.model.admitModelRequest({
        route: options.route,
        requestBody: serializeNativeExternalJson(finalBody),
      })
      options.toolBridge.commitContexts(contextReservation)
      contextsCommitted = true
      const signal = AbortSignal.any([requestSignal, lease.signal])
      signal.throwIfAborted()
      const upstream = await options.forward(finalBody, signal)
      if (upstream.status < 200 || upstream.status >= 300) {
        const cancellationError = await cancelBody(upstream.body)
        if (cancellationError !== undefined) {
          fatal(cancellationError instanceof Error
            ? cancellationError
            : new Error('Responses error body cancellation failed', { cause: cancellationError }))
        }
        await settleFailure({ kind: 'http', statusCode: upstream.status, events: [] })
        return jsonError(upstream.status, 'The selected model provider rejected the request.')
      }
      if (upstream.status !== 200) {
        const error = new GatewayFailure(
          'Responses provider returned an unexpected successful status',
          { kind: 'protocol', code: 'invalid-sse' },
          [],
        )
        blockAdmission(error)
        const cancellationError = await cancelBody(upstream.body)
        fatal(cancellationError === undefined
          ? error
          : new AggregateError([
            error,
            cancellationError instanceof Error
              ? cancellationError
              : new Error('Responses body cancellation failed', { cause: cancellationError }),
          ], 'Responses provider returned an invalid response and its body could not be cancelled'))
        await settleFailure(nativeFailure(error))
        return jsonError(502, 'The selected model provider returned an unsupported response.')
      }
      if (upstream.contentType === null || !/^text\/event-stream(?:\s*;|$)/i.test(upstream.contentType)) {
        const error = new GatewayFailure(
          'Responses provider did not return an SSE stream',
          { kind: 'protocol', code: 'invalid-sse' },
          [],
        )
        blockAdmission(error)
        const cancellationError = await cancelBody(upstream.body)
        fatal(cancellationError === undefined
          ? error
          : new AggregateError([
            error,
            cancellationError instanceof Error
              ? cancellationError
              : new Error('Responses body cancellation failed', { cause: cancellationError }),
          ], 'Responses provider returned a non-SSE body that could not be cancelled'))
        await settleFailure(nativeFailure(error))
        return jsonError(502, 'The selected model provider returned an unsupported response.')
      }
      let bytes: Uint8Array
      try {
        bytes = await readBytes(upstream.body, options.limits.responseBytes, signal, true)
      } catch (error: unknown) {
        if (!(error instanceof GatewayBodyReadFailure)) throw error
        let prefix = parseSse('', options.limits, catalog, false)
        if (error.bytes.byteLength > 0) {
          try {
            const decoder = new TextDecoder('utf-8', { fatal: true })
            const text = decoder.decode(error.bytes, { stream: true })
            prefix = parseSse(text, options.limits, catalog, false)
          } catch (_decodeError: unknown) {
            const failure = new GatewayFailure(
              'Responses stream prefix is not valid UTF-8',
              { kind: 'protocol', code: 'invalid-sse' },
              [],
            )
            fatal(failure)
            await settleFailure(nativeFailure(failure))
            return jsonError(502, 'The selected model provider returned an invalid response.')
          }
        }
        if (prefix.failure !== undefined) {
          fatal(prefix.failure)
          await settleFailure(nativeFailure(prefix.failure))
          return jsonError(502, 'The selected model provider returned an invalid response.')
        }
        if (error.cancellationError !== undefined) {
          fatal(error.cancellationError instanceof Error
            ? error.cancellationError
            : new Error('Responses stream cancellation failed'))
        }
        if (error.sizeExceeded) {
          const failure = new GatewayFailure(
            'Responses stream exceeds the supported size limit',
            { kind: 'protocol', code: 'invalid-sse' },
            prefix.events,
            prefix.completed,
          )
          fatal(failure)
          await settleFailure(nativeFailure(failure))
          return jsonError(502, 'The selected model provider returned an unsupported response.')
        }
        await settleFailure({
          kind: 'transport',
          events: prefix.events.map(event => serializeNativeExternalJson(event)),
        })
        return jsonError(502, 'The selected model provider connection ended early.')
      }
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new GatewayFailure('Responses stream is not valid UTF-8', { kind: 'protocol', code: 'invalid-sse' }, [])
      }
      const result = parseSse(text, options.limits, catalog)
      if (result.failure !== undefined) {
        fatal(result.failure)
        await settleFailure(nativeFailure(result.failure))
        return jsonError(502, 'The selected model provider returned an invalid response.')
      }
      if (result.terminalFailure !== undefined) {
        await settleFailure({
          kind: 'model',
          events: result.events.map(event => serializeNativeExternalJson(event)),
          terminal: serializeNativeExternalJson(result.terminalFailure),
        })
        return jsonError(502, 'The selected model provider did not complete the response.')
      }
      const completed = result.completed
      if (completed === undefined) throw new Error('gateway parser returned no terminal response')
      let toolCalls: readonly NativeExternalToolCall[]
      try {
        toolCalls = parseCodexResponsesToolCalls(completed, catalog, { jsonDepth: options.limits.jsonDepth })
      } catch {
        const failure = new GatewayFailure(
          'Responses function calls do not match the advertised Native schemas',
          { kind: 'protocol', code: 'invalid-response' },
          result.events,
          completed,
        )
        fatal(failure)
        await settleFailure(nativeFailure(failure))
        return jsonError(502, 'The selected model provider returned an unsupported function call.')
      }
      settlement.started = true
      try {
        const grants = await options.model.recordModelResponse(lease, {
          events: result.events.map(event => serializeNativeExternalJson(event)),
          completed: serializeNativeExternalJson(completed),
          toolCalls,
        })
        settlement.finished = true
        options.toolBridge.registerResponseGrants(lease.sequence, toolCalls, grants)
      } catch (error: unknown) {
        fatal(error instanceof Error ? error : new Error('Engine failed to record the model response'))
        throw error
      }
      signal.throwIfAborted()
      if (hasFatalError()) return jsonError(403, 'Native model operation is no longer available.')
      return new Response(new Uint8Array(bytes), {
        status: upstream.status,
        headers: { 'content-type': upstream.contentType },
      })
    } catch (error: unknown) {
      if (error instanceof UnauthorizedGatewayRequest) return jsonError(403, 'Native model operation rejected the local request.')
      if (lease !== undefined && !settlement.started) {
        if (error instanceof GatewayFailure) fatal(error)
        try {
          await settleFailure(error instanceof GatewayFailure
            ? nativeFailure(error)
            : { kind: 'transport', events: [] })
        } catch {
          // The Engine failure is already latched; the gateway must not expose an unlogged outcome.
        }
      } else if (lease !== undefined && settlement.started && !settlement.finished) {
        fatal(error instanceof Error ? error : new Error('Engine failed to settle the model attempt'))
      } else if (lease === undefined && error instanceof GatewayFailure) {
        fatal(error)
      }
      return jsonError(error instanceof GatewayFailure ? 403 : 502, 'Native model operation was stopped.')
    } finally {
      if (contextReservation !== undefined && !contextsCommitted) {
        options.toolBridge.releaseContexts(contextReservation)
      }
    }
  }
  return handler
}
