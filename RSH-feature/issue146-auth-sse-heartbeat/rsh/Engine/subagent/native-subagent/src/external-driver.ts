/** Native-owned contract for a product child with no local Agent or Session. */
import type { ContentBlock, ReasoningEffortId, ToolCallId, ToolSchema, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-native-tools/json-schema'
import type { NativeToolResult, NativeToolRestriction, StoredImageAttachment } from '@deepseek-ai/dsh-native-tools'
import type { ToolSdkSchema } from '@deepseek-ai/dsh-native-tools/sdk-typescript'
import type { NativeSessionDelegationAuthority } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeResponsesTransport } from '@deepseek-ai/dsh-native-model-execution/responses-transport'

declare const externalSubagentId: unique symbol
const externalAttemptLease: unique symbol = Symbol('native-external-model-attempt-lease')
const externalToolCallGrant: unique symbol = Symbol('native-external-tool-call-grant')
declare const externalSerializedJson: unique symbol

/** Opaque identity for a remote child; it is not a local SessionId. */
export type NativeExternalSubagentId = string & { readonly [externalSubagentId]: true }

/** JSON-safe data accepted from a product-owned wire parser. */
export type NativeExternalJsonValue = null | boolean | number | string
  | readonly NativeExternalJsonValue[]
  | { readonly [key: string]: NativeExternalJsonValue }

/** Serialized JSON document supplied by the external product adapter, without transport headers or environment. */
export type NativeExternalSerializedJson = string & { readonly [externalSerializedJson]: true }

/** Serialize one parsed JSON document for the parent-owned operation log.
 * @param value - JSON document already parsed and filtered by the product adapter.
 * @returns serialized JSON text. The caller must exclude transport headers, credentials, and environment before calling.
 */
export function serializeNativeExternalJson(value: NativeExternalJsonValue): NativeExternalSerializedJson {
  const serialized = JSON.stringify(value)
  return serialized as NativeExternalSerializedJson
}

/** One exact model route selected by the Native parent. */
export interface NativeExternalModelRoute {
  readonly provider: string
  readonly model: string
}

/** One typed route and complete model-visible JSON body before an outbound inference attempt. */
export interface NativeExternalModelRequest {
  readonly route: NativeExternalModelRoute
  /** Complete Responses request object, including all input and tools; transport data is excluded. */
  readonly requestBody: NativeExternalSerializedJson
}

/** Engine-created lease for one actual outbound inference attempt. */
export interface NativeExternalModelAttemptLease {
  readonly sequence: number
  /** Operation cancellation; the adapter must stop and settle this attempt when aborted. */
  readonly signal: AbortSignal
  readonly [externalAttemptLease]: true
}

/** Create an opaque lease for the Engine that owns the external operation.
 * @param sequence - positive, monotonically increasing operation attempt number.
 * @param signal - exact operation cancellation signal.
 * @returns a lease that only the issuing operation accepts.
 * @internal
 */
export function issueNativeExternalModelAttemptLease(
  sequence: number,
  signal: AbortSignal,
): NativeExternalModelAttemptLease {
  return Object.freeze({ sequence, signal, [externalAttemptLease]: true as const })
}

/** Issue one operation-bound grant for a parsed call in a durably recorded model response.
 * @param call - exact product-parsed call fields selected from that response.
 * @returns opaque grant accepted only by the Native operation that issued it.
 * @internal
 */
export function issueNativeExternalToolCallGrant(call: NativeExternalToolCall): NativeExternalToolCallGrant {
  return Object.freeze({ ...call, arguments: structuredClone(call.arguments), [externalToolCallGrant]: true as const })
}

/** Complete successful Responses stream retained before Codex consumes it. */
export interface NativeExternalModelResponse {
  /** Every parsed SSE data object in wire order, serialized individually. */
  readonly events: readonly NativeExternalSerializedJson[]
  /** Complete parsed `response.completed` object. */
  readonly completed: NativeExternalSerializedJson
  /** Calls selected by the product parser from this exact completion. */
  readonly toolCalls: readonly NativeExternalToolCall[]
}

/** One wire-parsed function call selected from a recorded Responses completion. */
export interface NativeExternalToolCall {
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: JsonValue
}

/** Opaque, one-use authority returned only after its model response is durable. */
export interface NativeExternalToolCallGrant extends NativeExternalToolCall {
  readonly [externalToolCallGrant]: true
}

/** Model-callable and PTC-only catalogs captured from one exact Native owner snapshot. */
export interface NativeExternalToolCatalog {
  readonly schemas: readonly ToolSchema[]
  readonly programSchemas: readonly ToolSdkSchema[]
  readonly promptText: string
}

/** Durable tool outcome plus model-context effects selected by Native settlement. */
export interface NativeExternalToolSettlement {
  readonly result: NativeToolResult
  readonly settlementContexts: readonly UserMessage[]
  readonly concludesTurn: boolean
  /** Verified bytes for image references in the recorded result and accepted contexts. */
  readonly images: readonly StoredImageAttachment[]
}

/** Retained upstream failure and any partial SSE objects received before it. */
export type NativeExternalModelFailure =
  | {
    readonly kind: 'http'
    readonly statusCode: number
    readonly events: readonly NativeExternalSerializedJson[]
  }
  | { readonly kind: 'transport'; readonly events: readonly NativeExternalSerializedJson[] }
  | {
    readonly kind: 'model'
    readonly events: readonly NativeExternalSerializedJson[]
    readonly terminal: NativeExternalSerializedJson
  }
  | {
    readonly kind: 'policy'
    readonly code: 'tool-not-authorized' | 'route-mismatch' | 'policy-rejected'
    readonly events: readonly NativeExternalSerializedJson[]
    readonly completed?: NativeExternalSerializedJson
  }
  | {
    readonly kind: 'protocol'
    readonly code: 'invalid-sse' | 'invalid-response' | 'unsupported-item'
    readonly events: readonly NativeExternalSerializedJson[]
    readonly completed?: NativeExternalSerializedJson
  }

/** Narrow model-request and response port captured for one external operation. */
export interface NativeExternalSubagentModelOperations {
  /** Tool schemas and prompt text captured from the exact active Native parent. */
  readonly tools: NativeExternalToolCatalog
  /** Persist and reserve one real inference attempt before the adapter forwards it.
   * @param request - exact Engine route and complete sanitized JSON request body.
   * @returns single-operation lease after the parent writer flushes the request event.
   */
  admitModelRequest(request: NativeExternalModelRequest): Promise<NativeExternalModelAttemptLease>
  /** Persist one complete successful response before the adapter exposes it to Codex.
   * @param lease - exact unsettled lease issued to this operation.
   * @param response - parsed SSE events, terminal object, and its exact call projection.
   * @returns one-use call grants after the parent writer flushes the response event.
   */
  recordModelResponse(
    lease: NativeExternalModelAttemptLease, response: NativeExternalModelResponse,
  ): Promise<readonly NativeExternalToolCallGrant[]>
  /** Persist one failed attempt, including any partial SSE events, before retry or failure is exposed.
   * @param lease - exact unsettled lease issued to this operation.
   * @param failure - HTTP status or transport outcome and received partial SSE events.
   * @returns completion after the parent writer flushes the failure event.
   */
  recordModelFailure(lease: NativeExternalModelAttemptLease, failure: NativeExternalModelFailure): Promise<void>
  /** Execute one exact grant after persisting call, result and Native settlement facts in order.
   * @param grant - one-use call authority returned by recordModelResponse.
   * @param signal - product operation cancellation.
   * @returns Native result and the exact contexts/conclusion allowed into subsequent inference.
   */
  executeTool(grant: NativeExternalToolCallGrant, signal: AbortSignal): Promise<NativeExternalToolSettlement>
  /** Latch an Engine or product-policy failure and synchronously cancel this operation.
   * @param error - terminal failure that later product completion cannot override.
   */
  fatal(error: Error): void
}

/** Owner and invocation-root lineage shared by every external operation fact. */
export interface NativeExternalOperationEventBase {
  readonly version: 0
  readonly id: NativeExternalSubagentId
  readonly parentSessionId: SessionId
  readonly parentEpoch: string
  readonly rootSessionId: SessionId
  readonly rootEpoch: string
}

/** Required-on-read parent events for every model request and tool outcome. */
export type NativeExternalOperationEvent =
  | (NativeExternalOperationEventBase & {
    readonly kind: 'model-request'
    readonly sequence: number
    readonly route: NativeExternalModelRoute
    readonly requestBody: NativeExternalSerializedJson
    readonly at: number
  })
  | (NativeExternalOperationEventBase & {
    readonly kind: 'model-response'
    readonly sequence: number
    readonly events: readonly NativeExternalSerializedJson[]
    readonly completed: NativeExternalSerializedJson
    readonly toolCalls: readonly NativeExternalToolCall[]
    readonly at: number
  })
  | (NativeExternalOperationEventBase & {
    readonly kind: 'model-failure'
    readonly sequence: number
    readonly failure: NativeExternalModelFailure
    readonly at: number
  })
  | (NativeExternalOperationEventBase & {
    readonly kind: 'tool-call'
    readonly modelSequence: number
    readonly callId: ToolCallId
    readonly name: string
    readonly arguments: JsonValue
    readonly at: number
  })
  | (NativeExternalOperationEventBase & {
    readonly kind: 'tool-result'
    readonly modelSequence: number
    readonly callId: ToolCallId
    readonly name: string
    readonly arguments: JsonValue
    readonly result: NativeToolResult
    readonly at: number
  })
  | (NativeExternalOperationEventBase & {
    readonly kind: 'tool-settlement'
    readonly modelSequence: number
    readonly callId: ToolCallId
    readonly settlementContexts: readonly UserMessage[]
    readonly concludesTurn: boolean
    readonly at: number
  })

/** Terminal result vocabulary shared by Native and external child adapters. */
export type NativeSubagentStopReason = 'completed' | 'max-tokens' | 'aborted' | 'refusal' | 'error'

/** Product route overrides explicitly selected by the installed tool/profile configuration. */
export interface NativeExternalSubagentRouteOverrides {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: ReasoningEffortId
}

/** Route fields a concrete Module can honor before it starts a process. */
export type NativeExternalSubagentRouteField = keyof NativeExternalSubagentRouteOverrides

/** One approval question for a tool running inside an external child. */
export interface NativeExternalSubagentApprovalRequest {
  readonly operationId: NativeExternalSubagentId
  readonly requestId: string
  readonly toolName: 'write_file'
  readonly callId: string
  readonly reason?: string
  readonly signal: AbortSignal
}

/** Closed result of the exact parent's one-shot approval request. */
export type NativeExternalSubagentApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Narrow parent approval callback captured for one external-child admission. */
export type NativeExternalSubagentApprovalRequester =
  (request: NativeExternalSubagentApprovalRequest) => Promise<NativeExternalSubagentApprovalOutcome>

/** One external child may request approval only through its captured parent operation. */
export interface NativeExternalSubagentApprovalRelay {
  readonly operationId: NativeExternalSubagentId
  readonly request: NativeExternalSubagentApprovalRequester
}

/** Detached input to one external child. It has no Agent, Session, Cordis Context, or writer. */
export interface NativeExternalSubagentRequest {
  /** Identity minted by Native and persisted with this child's parent-owned lineage. */
  readonly id: NativeExternalSubagentId
  /** Exact live Native parent and invocation root selected during admission. */
  readonly parentSessionId: SessionId
  readonly rootSessionId: SessionId
  /** Private per-owner epochs distinguish replacements that reuse a Session id. */
  readonly parentEpoch: string
  readonly rootEpoch: string
  /** Current persisted delegation depth and configured child ceiling. */
  readonly parentDepth: number
  readonly maxDepth: number
  /** Parent-derived execution ceilings; the adapter may reduce but never raise them. */
  readonly limits: { readonly maxSteps: number; readonly maxTokens?: number }
  /** Capabilities resolved from the exact initiating parent Session. */
  readonly authority: NativeSessionDelegationAuthority
  /** Task label and exact Program-selected workspace. */
  readonly label: string
  readonly cwd: string
  /** Detached authored task only; parent conversation history is not transferred. */
  readonly prompt: readonly ContentBlock[]
  /** Engine-resolved route and explicit deployment overrides, never selected by the remote child. */
  readonly route: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: ReasoningEffortId
    readonly overrides: NativeExternalSubagentRouteOverrides
  }
  /** Engine-owned per-operation model admission and transcript writer callbacks. */
  readonly model: NativeExternalSubagentModelOperations
  /** Borrowed transport for a Responses product; the Engine alone closes it after product disposal and request drains. */
  readonly responses?: NativeResponsesTransport
  /** Already-resolved child restrictions from the Native deployment. */
  readonly persona?: string
  readonly toolFilter?: NativeToolRestriction
  readonly outputSchema?: ObjectJsonSchema
  /** Parent approval for the builtin writer, when the exact parent grant and sandbox allow it. */
  readonly approval?: NativeExternalSubagentApprovalRelay
}

/** Terminal data returned by the external product after its real child has settled. */
export interface NativeExternalSubagentOutcome {
  /** Final child output reported by the selected product. */
  readonly output: readonly ContentBlock[]
  /** Schema-valid product value when the request carries an output schema. */
  readonly structured?: unknown
  /** Product terminal reason after child execution settles. */
  readonly stopReason: NativeSubagentStopReason
}

/** Product-owned run returned only after its actual readiness handshake. */
export interface NativeExternalSubagentRun {
  /** Product-owned session/thread identity established by that handshake. */
  readonly remoteId: string
  /** Settle with the product terminal result or cancellation after the owned range stops. */
  readonly result: Promise<NativeExternalSubagentOutcome>
  /** Cancel if needed and resolve only after the complete owned process range is quiescent. */
  dispose(): Promise<void>
}

/** Settled external result published to Native Consumers; no local Session is implied. */
export interface NativeExternalSubagentResult extends NativeExternalSubagentOutcome {
  readonly id: NativeExternalSubagentId
  readonly provider: string
  readonly remoteId: string
}

/** One external child's durable parent-owned readiness fact. */
export interface NativeExternalSubagentStartedEvent {
  readonly version: 0
  readonly id: NativeExternalSubagentId
  readonly provider: string
  readonly remoteId: string
  readonly label: string
  readonly parentSessionId: SessionId
  readonly parentEpoch: string
  readonly rootSessionId: SessionId
  readonly rootEpoch: string
  readonly startedAt: number
}

/** One external child's durable terminal fact, appended after confirmed range cleanup. */
export interface NativeExternalSubagentFinishedEvent {
  readonly version: 0
  readonly id: NativeExternalSubagentId
  readonly provider: string
  readonly remoteId: string
  readonly stopReason: NativeSubagentStopReason
  readonly finishedAt: number
}

/** Trusted product adapter mounted as a Native Module for one selected provider name. */
export interface NativeExternalSubagentDriver {
  /** Exact name configured by the selected Native Subagent Provider. */
  readonly name: string
  /** Responses drivers receive a transport from the exact prepared Provider generation or fail before child startup. */
  readonly modelProtocol?: 'responses'
  /** Supported explicit route overrides; an unsupported field is rejected before launch. */
  readonly routeFields: readonly NativeExternalSubagentRouteField[]
  /** Optional request features that this product actually enforces. */
  readonly capabilities: {
    /** Whether the product applies the resolved persona. */
    readonly persona: boolean
    /** Whether the product applies the resolved tool filter. */
    readonly toolFilter: boolean
    /** Whether the product validates and returns the requested structured output. */
    readonly outputSchema: boolean
    /** Whether the product transports one-shot approval requests to the exact parent. */
    readonly approvalRelay?: boolean
  }
  /** Start the selected product child and return only after a genuine readiness handshake.
   * @param request - detached, resolved child input.
   * @param signal - Native cancellation for this child.
   * @returns the product-owned child after its readiness handshake.
   */
  start(request: NativeExternalSubagentRequest, signal: AbortSignal): Promise<NativeExternalSubagentRun>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records a product child only after its real readiness handshake, with the exact Native parent and active-root lineage.
     * The owning parent Session writer flushes this event before Native publishes the child to consumers.
     */
    'subagent/external-start': NativeExternalSubagentStartedEvent
    /**
     * Records settlement only after the product confirms complete owned-range cleanup; a failed startup has no pair.
     */
    'subagent/external-end': NativeExternalSubagentFinishedEvent
    /**
     * Records complete model request and outcome JSON before the external product forwards or consumes it.
     * Parent and invocation-root ids and captured epochs bind every attempt to the exact admitted owners.
     */
    'subagent/external-operation': NativeExternalOperationEvent
  }
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** One product adapter selected by the Native Host installation and drained before its provider is disposed. */
    externalSubagentDriver: NativeExternalSubagentDriver
  }
}
