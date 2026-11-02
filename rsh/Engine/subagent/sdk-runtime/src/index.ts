/** Provider-neutral TypeScript SDK protocol runtime and Session API. */

export { RedSparkHarness, HarnessSession, createNativeSdkChildHarness } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
  createNativeHarnessClient,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@redspark/rsh-sdk-protocol'
export type {
  ContentBlock,
  LegacySdkPromptContentBlock,
  NativeSdkPromptContentBlock,
  SessionUploadFileResult,
  SdkPromptContentBlock,
  RshHarnessOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  NativeExternalOperationEvent,
  NativeExternalOperationSessionEvent,
  RunResult,
  NativeRshHarnessOptions,
  RuntimeProcessOptions,
  SdkApprovalOutcome,
  SdkApprovalHandler,
} from './types.ts'
export type { NativeSdkChildRuntime, NativeSdkChildRuntimeLauncher, NativeSdkChildRuntimeRequest } from './native.ts'
