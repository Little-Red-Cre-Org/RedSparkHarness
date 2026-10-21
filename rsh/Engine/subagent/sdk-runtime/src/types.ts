/**
 * Types for the TypeScript SDK client: launch options, notification shapes,
 * and owned activity results.
 *
 * @module @deepseek-ai/dsh-sdk-runtime/types
 */

import type { ContentBlock, ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import type { ApprovalRequestParams, SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-protocol'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'

/** Generic process settings supplied by the selected Program launcher. */
export interface RuntimeProcessOptions {
  command: string
  args: string[]
  cwd?: string
  environment: () => NodeJS.ProcessEnv
  description: string
  initializeTimeoutMs: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  disposeEofGraceMs?: number
  disposeGraceMs?: number
}

/** One server-to-client notification as received off the wire. */
export interface HarnessNotification {
  /** The JSON-RPC notification method name. */
  method: string
  /** The raw params object; see `HarnessSdkNotificationMap` for the shapes per method. */
  params: Record<string, unknown>
}

/** Predicate deciding whether a subscription receives a notification. */
export type NotificationFilter = (notification: HarnessNotification) => boolean

/** Closed result for a Native approval request. */
export type SdkApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** User callback that answers one approval request from the selected runtime. */
export type SdkApprovalHandler = (
  request: ApprovalRequestParams, signal: AbortSignal,
) => Promise<SdkApprovalOutcome> | SdkApprovalOutcome

/** Launch and timeout options for {@link HarnessClient}. */
export interface HarnessClientOptions {
  /** Absolute or caller-relative dsh CLI module; omitted resolves this package's same-version dependency. */
  dshBin?: string
  /** Named profile serving the SDK protocol (default `sdk`). */
  profile?: string
  /** Ordered per-launch profile patches; relative paths resolve before spawn. */
  patches?: string[]
  /** Explicit Harness home for this child; relative paths resolve before spawn. */
  dshHome?: string
  /** Working directory for the dsh process itself. */
  processCwd?: string
  /**
   * The complete child environment, read when {@link HarnessClient.start}
   * spawns. `undefined` reads the parent env at that time; passing an object
   * reads that object at spawn and replaces the parent environment entirely, so callers own
   * credential policy (see `scrubbedParentEnv` in `@deepseek-ai/dsh-subprocess`
   * for the shared scrub-then-merge base). The standard Program launcher adds
   * the host `SystemRoot` on Windows when the supplied environment omits it.
   */
  env?: NodeJS.ProcessEnv
  /** Bound (ms) for the initial profile-ready handshake (default 30000). */
  initializeTimeoutMs?: number
  /** Per-request timeout (ms); `undefined` waits indefinitely (a turn can legitimately run long). */
  requestTimeoutMs?: number
  /** Answer Native approval requests received from the runtime; omission fails them closed. */
  onApprovalRequest?: SdkApprovalHandler
  /** Bound (ms) on the protocol `shutdown` exchange and stdio flush inside `close()` (default 1000). */
  shutdownTimeoutMs?: number
  /** Grace (ms) for the runtime's stdin-EOF quiesce during `close()` (default 6000). */
  disposeEofGraceMs?: number
  /** Provider termination grace for escalation and owned-range confirmation during `close()` (default 3000). */
  disposeGraceMs?: number
}

/** Options for the high-level {@link DeepSeekHarness} wrapper. */
export interface DeepSeekHarnessOptions extends HarnessClientOptions {
  /** Workspace cwd recorded on every SDK-created session (default: the process cwd, else `process.cwd()`). */
  cwd?: string
  /** Provider route for SDK-created agents (default `deepseek-official`). */
  provider?: string
  /** Model for SDK-created agents (default `deepseek-v4-flash`). */
  model?: string
  /** Adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
  /** Requested maximum model steps per turn; the Native SDK profile reports its effective cap during initialization. */
  maxSteps?: number
  /** Restrict model-visible tools to these names; this never installs or grants a tool. */
  allowedTools?: readonly string[]
  /** Native SDK-only write fence for child composition; reads remain bounded by cwd. */
  workspaceWriteRoot?: string
}

/** Native Host options that retain the standard dsh launcher and fix the `native-sdk` profile. */
export interface NativeDeepSeekHarnessOptions extends Omit<DeepSeekHarnessOptions, 'dshBin' | 'profile' | 'patches'> {}

/** One owned session activity interval, from enqueue receipt through idle. */
export interface RunResult {
  /** The session the activity ran on. */
  sessionId: string
  /** Concatenated text of the interval's last assistant message (empty when none). */
  finalResponse: string
  /** Every `session.event` payload for the root session, in wire order. */
  events: SessionEvent[]
  /** Every notification for the root session and discovered descendants, in wire order. */
  notifications: HarnessNotification[]
}

/** Re-exported content-block alias so SDK callers need no extra import. */
export type { ContentBlock }
export type { SdkPromptContentBlock }
