/** Program-owned launch seam for the fixed Native ACP child profile. */

import type { ChildConnectionHandle } from '@deepseek-ai/dsh-subprocess/native'
import type { SandboxExecutionPolicy, SandboxEnforcement } from '@deepseek-ai/dsh-sandbox/native-types'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-native-runtime'

/** Exact selected child route and policy passed to the fixed CLI launcher. */
export interface NativeAcpChildRuntimeRequest {
  /** Exact live parent Session whose authority bounds the child. */
  readonly parentSessionId: SessionId
  /** Workspace selected by the parent Session. */
  readonly cwd: string
  /** Selected child provider route. */
  readonly provider: string
  /** Selected child model id. */
  readonly model: string
  /** Selected child reasoning effort, when one is configured. */
  readonly reasoningEffort?: ReasoningEffortId
  /** Non-secret provider configuration needed to reproduce the selected route. */
  readonly providerProfile: Readonly<Record<string, unknown>>
  /** Only the selected route credential, under its configured environment name. */
  readonly environment: Readonly<Record<string, string>>
  /** Fixed child-profile instruction; the parent conversation prompt is never copied here. */
  readonly systemPrompt: string
  /** Accepted maximum model steps per child turn. */
  readonly maxSteps: number
  /** Optional accepted output-token ceiling per model request. */
  readonly maxTokens?: number
  /** Permission mode negotiated with the child Native ACP server. */
  readonly permissionMode: 'deny' | 'parent-relay'
  /** Native builtin tools admitted by the exact parent authority. */
  readonly builtinTools: readonly ('read_file' | 'write_file')[]
  /** Complete allowed-tool list for the fixed child profile. */
  readonly allowedTools: readonly string[]
  /** Exact workspace root for Native file writes, only when parent write authority permits them. */
  readonly workspaceWriteRoot?: string
  /** Exact parent execution policy; launchers may enforce a stricter policy. */
  readonly parentPolicy: SandboxExecutionPolicy
}

/** Started, managed Native ACP process and its private DSH_HOME cleanup. */
export interface NativeAcpChildRuntime {
  /** Whole-range-owned child and ACP stdio streams. */
  readonly child: ChildConnectionHandle
  /** File-effect enforcement reported by the selected sandbox backend. */
  readonly enforcement: SandboxEnforcement
  /** Close stdin and settle the complete managed process range. */
  shutdown(): Promise<void>
  /** Confirm shutdown, then remove the launcher's private DSH_HOME. */
  dispose(): Promise<void>
}

/** CLI-owned launcher for the fixed, same-version Native ACP profile. */
export interface NativeAcpChildRuntimeLauncher {
  /**
   * Start one exact ACP profile under a policy derived from the parent Session.
   * @param request - selected route, limits, tools, credential and owner policy.
   * @param signal - cancellation for startup and process lifetime.
   * @returns a managed process; its private home is removed only after caller teardown.
   */
  launch(request: NativeAcpChildRuntimeRequest, signal: AbortSignal): Promise<NativeAcpChildRuntime>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { acpChildRuntimeLauncher: NativeAcpChildRuntimeLauncher }
}
