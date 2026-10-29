/**
 * Shared wire protocol for the RedSpark Harness SDK runtime: the
 * newline-delimited JSON-RPC stdio transport plus the named request, result,
 * and notification types both wire ends speak. The runtime server plugin
 * (`@deepseek-ai/dsh-sdk-jsonrpc-server`) serves this protocol; SDK clients
 * (`@deepseek-ai/dsh-sdk-client`, the Python SDK) drive it.
 *
 * @module @deepseek-ai/dsh-sdk-protocol
 */

export { JsonRpcLineTransport, JsonRpcResponseError } from './transport.ts'
export type { JsonRpcTransportPeer } from './transport.ts'
export type {
  ApprovalCancelNotification,
  ApprovalRequestParams,
  ApprovalRequestResult,
  HarnessSdkIncomingRequestMap,
  HarnessSdkNotificationMap,
  HarnessSdkRequestMap,
  InitializeParams,
  InitializeResult,
  LegacySdkPromptContentBlock,
  NativeSdkPromptContentBlock,
  SdkFileReceiptBlock,
  SdkEncodedImageBlock,
  SdkTextBlock,
  SdkPromptContentBlock,
  SdkRunStatus,
  SessionChunkNotification,
  SessionCancelParams,
  SessionCancelResult,
  SessionEventNotification,
  SessionForkParams,
  SessionForkResult,
  SessionStatusNotification,
  SessionPromptParams,
  SessionPromptResult,
  SessionUploadFileParams,
  SessionUploadFileResult,
  SessionSteerParams,
  SessionSteerResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from './types.ts'
export type { NativeStagedFileReceiptId } from '@deepseek-ai/dsh-native-session-execution'
