/** Native Host capability for launching the fixed, same-version SDK child runtime. */

import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { SandboxExecutionPolicy, SandboxEnforcement } from '@deepseek-ai/dsh-sandbox/native-types'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type { ApprovalRequestParams } from '@deepseek-ai/dsh-sdk-protocol'
import type { RuntimeProcessOptions } from './types.ts'

/** Decision accepted by the one parent-bound Native SDK approval relay. */
export type NativeSdkChildApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Private Host callback for one external-child approval operation. */
export interface NativeSdkChildApprovalRelay {
  readonly operationId: string
  request(request: ApprovalRequestParams, signal: AbortSignal): Promise<NativeSdkChildApprovalOutcome>
}

/** Data needed to prepare the selected SDK route without carrying the parent environment wholesale. */
export interface NativeSdkChildRuntimeRequest {
  /** Exact live parent Session identity captured by Native Session execution ownership. */
  readonly parentSessionId: SessionId
  readonly cwd: string
  readonly provider: string
  readonly model: string
  readonly providerProfile: object
  readonly environment: Readonly<Record<string, string>>
  /** Native Headless builtin tools granted by the exact parent Session. */
  readonly builtinTools: readonly ('read_file' | 'write_file')[]
  /** Install NativeApproval only when this child is bound to its parent's approval authority. */
  readonly parentApprovalRelay: boolean
  readonly parentPolicy: SandboxExecutionPolicy
}

/** Fixed dsh runtime, Host-owned stdio connection and isolated home for one child. */
export interface NativeSdkChildRuntime {
  readonly runtime: RuntimeProcessOptions
  readonly childConnection: ChildConnectionDefinition
  /** OS process file-effect classification; `unconfined` only represents an explicit danger-full-access parent. */
  readonly enforcement: SandboxEnforcement | 'unconfined'
  /** Remove only the private home created for this run, after the process owner confirms the range is empty. */
  dispose(): Promise<void>
}

/** Program-owned fixed launcher that confines a Native SDK child to its parent's effective policy. */
export interface NativeSdkChildRuntimeLauncher {
  launch(request: NativeSdkChildRuntimeRequest, signal: AbortSignal): Promise<NativeSdkChildRuntime>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sdkChildRuntimeLauncher: NativeSdkChildRuntimeLauncher }
}
