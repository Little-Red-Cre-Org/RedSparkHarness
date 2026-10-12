/** Catalog and parse Native-captured tools for Codex app-server and Responses API calls.
 * @module @deepseek-ai/dsh-codex-app-server/src/dynamic-tools
 */

import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  NativeExternalJsonValue,
  NativeExternalSubagentModelOperations,
  NativeExternalToolCall,
} from '@deepseek-ai/dsh-native-subagent/native'
import type { NativeResponsesGatewayLimits } from './responses-gateway.ts'

/** Codex app-server 0.162.1 function entry accepted by `thread/start.dynamicTools`. */
export interface CodexAppServerDynamicToolSpec {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

/** Responses API function schema derived from the same captured Engine tool. */
export interface CodexResponsesFunctionTool {
  readonly type: 'function'
  readonly strict: false
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

/** One flat-name catalog shared by Codex registration and Responses requests. */
export interface CodexDynamicToolCatalog {
  readonly appServerTools: readonly CodexAppServerDynamicToolSpec[]
  readonly responsesTools: readonly CodexResponsesFunctionTool[]
  readonly promptText: string
  /** Resolve the flat namespace of one captured tool name.
   * @param name - Exact tool name from the model response.
   * @returns `null` for a captured flat tool name, otherwise `undefined`.
   */
  namespaceFor(name: string): string | null | undefined
}

/** Project the exact captured model-callable tools into both Codex wire catalogs.
 * Program schemas remain represented by the captured prompt text and do not become direct calls.
 * @param tools - Model and program schemas captured from one Native parent operation.
 * @returns Codex registrations and Responses tools with a shared flat-name identity lookup.
 */
export function createCodexDynamicToolCatalog(
  tools: NativeExternalSubagentModelOperations['tools'],
): CodexDynamicToolCatalog {
  const names = new Set(tools.schemas.map(schema => schema.name))
  return {
    appServerTools: tools.schemas.map(schema => ({
      type: 'function',
      name: schema.name,
      description: schema.description,
      inputSchema: schema.parameters,
    })),
    responsesTools: tools.schemas.map(schema => ({
      type: 'function',
      strict: false,
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    })),
    promptText: tools.promptText,
    namespaceFor(name: string): string | null | undefined {
      return names.has(name) ? null : undefined
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonValue(value: unknown, maxDepth: number): JsonValue {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    const item = current.value
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Codex function-call arguments contain a non-finite number')
      continue
    }
    if (current.depth >= maxDepth) throw new TypeError('Codex function-call arguments exceed the JSON depth limit')
    if (Array.isArray(item)) {
      for (const child of item) pending.push({ value: child, depth: current.depth + 1 })
      continue
    }
    if (!isRecord(item) || Object.getPrototypeOf(item) !== Object.prototype) {
      throw new TypeError('Codex function-call arguments are not JSON')
    }
    for (const child of Object.values(item)) pending.push({ value: child, depth: current.depth + 1 })
  }
  return value as JsonValue
}

function parseArguments(value: unknown, maxDepth: number): JsonValue {
  if (typeof value !== 'string') throw new TypeError('Codex function-call arguments must be a JSON string')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new TypeError('Codex function-call arguments are invalid JSON')
  }
  if (!isRecord(parsed)) throw new TypeError('Codex function-call arguments must be a JSON object')
  return jsonValue(parsed, maxDepth)
}

/** Parse the executable calls from the same full completion recorded by the Engine broker.
 * Only captured flat function names are admitted; other output item kinds fail closed.
 * @param completed - Complete `response.completed` SSE object validated by the gateway.
 * @param catalog - Exact tool catalog registered for this Codex thread.
 * @param limits - Gateway JSON limits applied to parsed call arguments.
 * @returns Calls in Responses output order; the Engine issues grants only after durable recording.
 */
export function parseCodexResponsesToolCalls(
  completed: NativeExternalJsonValue,
  catalog: CodexDynamicToolCatalog,
  limits: Pick<NativeResponsesGatewayLimits, 'jsonDepth'>,
): readonly NativeExternalToolCall[] {
  if (!isRecord(completed) || completed.type !== 'response.completed' || !isRecord(completed.response)) {
    throw new TypeError('Codex function calls require a completed Responses event')
  }
  const response = completed.response
  if (response.status !== 'completed' || typeof response.id !== 'string' || !Array.isArray(response.output)) {
    throw new TypeError('Codex completed Responses event is malformed')
  }

  const calls: NativeExternalToolCall[] = []
  const callIds = new Set<string>()
  for (const item of response.output) {
    if (!isRecord(item) || typeof item.type !== 'string') {
      throw new TypeError('Codex completed Responses output item is malformed')
    }
    if (item.type === 'message' || item.type === 'reasoning') continue
    if (item.type !== 'function_call') {
      throw new TypeError(`Codex Responses output item ${JSON.stringify(item.type)} is unsupported`)
    }
    if (item.namespace !== undefined && item.namespace !== null) {
      throw new TypeError('Codex namespaced function calls are unsupported')
    }
    if (typeof item.call_id !== 'string' || item.call_id.length === 0
      || typeof item.name !== 'string' || item.name.length === 0) {
      throw new TypeError('Codex function call is missing its id or name')
    }
    if (catalog.namespaceFor(item.name) !== null) {
      throw new TypeError(`Codex function call ${JSON.stringify(item.name)} is not in the captured catalog`)
    }
    if (callIds.has(item.call_id)) throw new TypeError('Codex Responses contains a duplicate function-call id')
    callIds.add(item.call_id)
    calls.push({
      callId: ToolCallId(item.call_id),
      name: item.name,
      arguments: parseArguments(item.arguments, limits.jsonDepth),
    })
  }
  return calls
}
