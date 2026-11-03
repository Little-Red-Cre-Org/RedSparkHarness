/**
 * Shared wire protocol for the RedSpark Harness SDK runtime: the
 * newline-delimited JSON-RPC stdio transport plus the named request, result,
 * and notification types both wire ends speak. The runtime server plugin
 * (`@redspark/rsh-sdk-jsonrpc-server`) serves this protocol; SDK clients
 * (`@redspark/rsh-sdk-client`, the Python SDK) drive it.
 *
 * @module @redspark/rsh-sdk-protocol
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
export type { NativeStagedFileReceiptId } from '@redspark/rsh-native-session-execution'
