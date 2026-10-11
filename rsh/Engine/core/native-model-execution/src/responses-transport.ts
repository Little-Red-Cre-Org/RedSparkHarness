/** Captured Responses transport operations from one prepared model generation. */
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'

/** Immutable JSON accepted by the captured provider's complete Responses request projector. */
export type NativeResponsesJsonValue = null | boolean | number | string
  | readonly NativeResponsesJsonValue[]
  | { readonly [key: string]: NativeResponsesJsonValue }

/** Exact provider and model route selected by the Engine. */
export interface NativeResponsesRoute {
  readonly provider: string
  readonly model: string
}

/** Response stream returned by a captured provider transport. */
export interface NativeResponsesTransportResponse {
  readonly status: number
  readonly contentType: string | null
  readonly body: ReadableStream<Uint8Array> | null
}

/** Captured provider operations consumed by one isolated Native Responses gateway. */
export interface NativeResponsesTransport {
  readonly route: NativeResponsesRoute
  /** Whether this captured provider generation enforces `max_output_tokens` on inference. */
  readonly outputTokenLimit: 'supported' | 'unsupported'
  /**
   * Project the complete request using this generation's model and image policy before admission.
   * @param body - complete Responses JSON before provider-specific projection.
   * @param signal - product operation cancellation.
   * @returns final JSON body to log and forward unchanged.
   */
  projectRequest(body: NativeResponsesJsonValue, signal: AbortSignal): Promise<NativeResponsesJsonValue>
  /**
   * Forward the exact projected request through this captured provider generation.
   * @param body - final projected JSON already admitted by the parent Engine.
   * @param signal - product operation cancellation.
   * @returns provider status, content type and response stream.
   */
  forward(body: NativeResponsesJsonValue, signal: AbortSignal): Promise<NativeResponsesTransportResponse>
  /**
   * Reject new calls and drain accepted projections, response streams, and credential refreshes.
   * @returns the same quiescent close result on repeated calls.
   */
  close(): Promise<void>
}

/** Capture a route from the provider generation retained by one prepared model call. */
export interface NativeResponsesGenerationCapture {
  /**
   * Capture a one-operation Responses transport from this exact prepared generation.
   * @param request - Engine-selected route and optional parent output-token ceiling.
   * @param signal - operation cancellation.
   * @returns a generation-bound transport that must be closed after the operation.
   * Partial resources must be released if cancellation or failure prevents returning a transport.
   */
  capture(request: { readonly route: NativeResponsesRoute; readonly maxTokens?: number }, signal: AbortSignal): Promise<NativeResponsesTransport>
}

/** One prepared Engine model generation that can capture an independent child operation. */
export interface NativeResponsesPreparedGeneration {
  readonly route: NativeResponsesRoute
  /**
   * Capture a child route from this exact generation, preparing a distinct Engine handle only when its route differs.
   * @param request - selected route and child limits.
   * @param signal - parent and child operation cancellation.
   * @returns an independent transport and the prepared generation bound to that child route.
   */
  capture(request: { readonly route: NativeResponsesRoute; readonly maxTokens?: number;
    readonly reasoningEffort?: ReasoningEffortId }, signal: AbortSignal): Promise<NativeResponsesOperationCapture>
}

/** Independent transport plus its exact prepared generation for nested external operations. */
export interface NativeResponsesOperationCapture {
  readonly transport: NativeResponsesTransport
  readonly generation: NativeResponsesPreparedGeneration
}

declare module '@deepseek-ai/dsh-llm/native' {
  interface PreparedAdapterCall {
    /** Provider-owned Responses operations captured with this exact model generation. */
    readonly nativeResponses?: NativeResponsesGenerationCapture
  }
}
