/** Provider-neutral TypeScript SDK protocol runtime and Session API. */

export { DeepSeekHarness, HarnessSession, createNativeSdkChildHarness } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
  createNativeHarnessClient,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol'
export type {
  ContentBlock,
  SdkPromptContentBlock,
  DeepSeekHarnessOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
  NativeDeepSeekHarnessOptions,
  RuntimeProcessOptions,
  SdkApprovalOutcome,
  SdkApprovalHandler,
} from './types.ts'
export type { NativeSdkChildRuntime, NativeSdkChildRuntimeLauncher, NativeSdkChildRuntimeRequest } from './native.ts'
