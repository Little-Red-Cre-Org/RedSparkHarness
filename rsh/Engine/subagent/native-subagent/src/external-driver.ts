/** Native-owned contract for a product child with no local Agent or Session. */
import type { ContentBlock, ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-native-tools/json-schema'
import type { NativeToolRestriction } from '@deepseek-ai/dsh-native-tools/types'

declare const externalSubagentId: unique symbol

/** Opaque identity for a remote child; it is not a local SessionId. */
export type NativeExternalSubagentId = string & { readonly [externalSubagentId]: true }

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
  /** Already-resolved child restrictions from the Native deployment. */
  readonly persona?: string
  readonly toolFilter?: NativeToolRestriction
  readonly outputSchema?: ObjectJsonSchema
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
  }
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** One product adapter selected by the Native Host installation and drained before its provider is disposed. */
    externalSubagentDriver: NativeExternalSubagentDriver
  }
}
