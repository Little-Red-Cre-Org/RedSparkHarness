/**
 * TypeScript client SDK for the RedSpark Harness runtime: spawn the
 * same-version `dsh --profile sdk` runtime as a subprocess and drive agent
 * turns over stdio JSON-RPC. `RedSparkHarness` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; named profiles and ordered patch
 * files customize the runtime process it spawns.
 *
 * @module @redspark/rsh-sdk-client
 */

export { RedSparkHarness, HarnessSession } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
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
  SdkApprovalOutcome,
  SdkApprovalHandler,
} from './types.ts'
