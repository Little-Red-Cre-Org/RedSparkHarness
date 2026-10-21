/**
 * Named wire types for the DeepSeek Harness SDK runtime protocol: the
 * request/result pairs and the server-to-client notification payloads
 * exchanged over the newline-delimited JSON-RPC stdio transport. The server
 * plugin (`@deepseek-ai/dsh-sdk-jsonrpc-server`) and SDK clients share these shapes;
 * `serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/types
 */

import type { ContentBlock, ReasoningEffortId, StreamChunk } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent-protocol'

/** Parameters for the process-wide SDK handshake. */
export interface InitializeParams {
  /** Working directory recorded on every SDK-created session's header. */
  cwd: string
  /** Provider route every SDK-created agent runs on. */
  provider: string
  /** Model name every SDK-created agent runs on (the server may mount a fallback adapter; see `HarnessSdkJsonRpcServer.initialize`). */
  model: string
  /** Optional adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Optional positive output-token cap inherited by SDK-created agents and their in-process descendants. */
  maxTokens?: number
  /** Optional positive per-turn step cap; supported Native SDK servers may reduce it to their profile limit. */
  maxSteps?: number
  /** Optional tool-name ceiling; only tools already installed by the selected runtime can remain available. */
  allowedTools?: string[]
  /** Native-only write boundary for SDK-created Agents; must be an absolute workspace path. */
  workspaceWriteRoot?: string
  /** Internal external-child identity used to pair Native approval relay requests. */
  approvalOperationId?: string
}

/** Wire-stable server identity returned by initialization. */
export interface InitializeResult {
  /** Wire-stable server identity (`deepseek-harness-sdk-runtime`) and version. */
  serverInfo: { name: string; version: string }
  /** Effective positive per-turn step cap when the server reports one. */
  maxSteps?: number
}

/** One user turn on one SDK session. */
export interface SessionPromptParams {
  /** The SDK-side session id; an unknown id lazily creates the agent+session pair. */
  sessionId: string
  /** The prompt content blocks, sent verbatim as the user message. */
  contentBlocks: SdkPromptContentBlock[]
}

/** Parameters for cancelling only the currently admitted native Session turn. */
export interface SessionCancelParams {
  /** Existing Session identity; unaccepted prompts are not cancelled. */
  sessionId: string
}

/** Reply after the selected native turn and its owned cleanup settle. */
export interface SessionCancelResult {
  /** False when no admitted turn was active; true after its cancellation settled. */
  cancelled: boolean
}

/** Parameters for copying a closed native Session turn into a fresh identity. */
export interface SessionForkParams {
  /** Readable source Session under the initialized workspace. */
  sessionId: string
  /** Fresh destination Session; existing identities are rejected. */
  destinationSessionId: string
  /** Source event whose containing turn has ended; omitted selects the last closed turn. */
  atSeq?: number
}

/** Reply after the copied history and fork marker are durable. */
export interface SessionForkResult {
  /** Fresh Session identity ready for a resumed prompt. */
  sessionId: string
}

/** Live projection of an accepted model chunk; not another durable event stream. */
export interface SessionChunkNotification {
  /** Session whose selected model dispatch accepted the chunk. */
  sessionId: string
  /** Shared model chunk; its completed or interrupted attempt owns durable reconstruction. */
  chunk: StreamChunk
}

/** Inline raster input admitted into the runtime's durable attachment store. */
export interface SdkEncodedImageBlock {
  type: 'image'
  /** Canonical base64-encoded raster bytes. */
  data: string
  /** Declared raster MIME type, verified during admission. */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}

/** SDK prompt input: ordinary durable blocks plus inline images awaiting admission. */
export type SdkPromptContentBlock = ContentBlock | SdkEncodedImageBlock

/** Ordered input for the active native SDK root's next step. */
export interface SessionSteerParams {
  /** Currently admitted Session owned by this SDK runtime. */
  sessionId: string
  /** Text and encoded image blocks admitted through the same attachment policy as prompts. */
  contentBlocks: SdkPromptContentBlock[]
}

/** Durable receipt for a next-step input; not a model result or interruption receipt. */
export interface SessionSteerResult {
  /** Identity retained in the durable next-step inbox. */
  messageId: string
}

/** Durable enqueue receipt for one prompt. */
export interface SessionPromptResult {
  /** Identity of the queued user message. */
  messageId: string
}

/** Deployment-mapped SDK outcome: `ok` for an accepted result, `error` otherwise. */
export type SdkRunStatus = 'ok' | 'error'

/** `session.event` payload: one session-log event, streamed as it is recorded. */
export interface SessionEventNotification {
  /** Session the event belongs to (every session in the runtime, not only SDK-created ones). */
  sessionId: string
  /** The full session-log event envelope. */
  event: SessionEvent
}

/** Whole-agent lifecycle state for one session. */
export interface SessionStatusNotification {
  /** Session whose live agent changed status. */
  sessionId: string
  /** The whole-agent state after the transition. */
  status: 'idle' | 'running'
}

/** `subagent.started` payload: an in-runtime child session was created. */
export interface SubagentStartedNotification {
  /** The delegating session. */
  parentSessionId: string
  /** The new child session. */
  childSessionId: string
}

/** `subagent.finished` payload: an in-process subagent run ended (remote runs are not reported). */
export interface SubagentFinishedNotification {
  /** Subagent provider name that ran the child. */
  provider: string
  /** The child agent's id (equals {@link childSessionId} for local runs). */
  agentId: string
  /** The delegating session. */
  parentSessionId: string
  /** The child session. */
  childSessionId: string
  /** Deployment-mapped run outcome. */
  status: SdkRunStatus
  /** The provider-reported stop reason. */
  stopReason: SubagentStopReason
  /** The child's selected assistant output; absent when the child produced none. */
  lastAssistantMessage?: ContentBlock[]
}

/** One cancellation for an outstanding parent approval request. */
export interface ApprovalCancelNotification {
  operationId: string
  requestId: string
}

/** One server-to-client approval question for the exact external-child operation. */
export interface ApprovalRequestParams {
  operationId: string
  requestId: string
  sessionId: string
  toolName: 'write_file'
  callId: string
  reason?: string
}

/** Closed response paired with one approval question. */
export interface ApprovalRequestResult {
  operationId: string
  requestId: string
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
}

/** Server-to-client notifications by JSON-RPC method name. */
export interface HarnessSdkNotificationMap {
  'approval/cancel': ApprovalCancelNotification
  'session.chunk': SessionChunkNotification
  'session.event': SessionEventNotification
  'session.status': SessionStatusNotification
  'subagent.started': SubagentStartedNotification
  'subagent.finished': SubagentFinishedNotification
}

/** Server-to-client request methods with their param and result shapes. */
export interface HarnessSdkIncomingRequestMap {
  'approval/request': { params: ApprovalRequestParams; result: ApprovalRequestResult }
}

/** Client-to-server request methods with their param and result shapes. */
export interface HarnessSdkRequestMap {
  'initialize': { params: InitializeParams; result: InitializeResult }
  'session/cancel': { params: SessionCancelParams; result: SessionCancelResult }
  'session/fork': { params: SessionForkParams; result: SessionForkResult }
  'session/steer': { params: SessionSteerParams; result: SessionSteerResult }
  'session/prompt': { params: SessionPromptParams; result: SessionPromptResult }
  'shutdown': { params: undefined; result: Record<string, never> }
}
