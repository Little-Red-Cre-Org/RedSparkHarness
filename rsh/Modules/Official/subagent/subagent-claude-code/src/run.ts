/** Compatibility adapter from the shared Claude product controller to ctx.subagents. */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  claudeQueryOptions as buildClaudeQueryOptions,
  consumeClaudeQuery as consumeClaudeProductQuery,
  startClaudeCodeProductRun,
  textTask,
  type ClaudeCodeRunSpec as ClaudeCodeProductRunSpec,
} from './controller.ts'

export {
  CLAUDE_CODE_PERMISSION_MODES,
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  claudeCodeStartupFailure,
  disposeClaudeCodeChild,
  successfulResult,
  textTask,
} from './controller.ts'
export type { ClaudeCodePermissionMode } from './controller.ts'

/** Compatibility diagnostics retain the shared out-of-process result vocabulary. */
export type ClaudeCodeRunSpec = Omit<ClaudeCodeProductRunSpec, 'onError'> & {
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** Build SDK options for one legacy profile-owned Claude query.
 * @param spec - resolved compatibility configuration and process hooks.
 * @param controller - per-query cancellation owner.
 * @param capture - captures the SDK-owned child and process.
 * @param captureDiagnostic - receives safe permission facts.
 * @returns the official SDK query options.
 */
export function claudeQueryOptions(
  spec: ClaudeCodeRunSpec,
  controller: AbortController,
  capture: Parameters<typeof buildClaudeQueryOptions>[2],
  captureDiagnostic: Parameters<typeof buildClaudeQueryOptions>[3],
): ReturnType<typeof buildClaudeQueryOptions> {
  const { onError: _onError, ...productSpec } = spec
  return buildClaudeQueryOptions(productSpec, controller, capture, captureDiagnostic)
}

/**
 * Preserve the old Cordis Provider's SubagentRun lifecycle over the shared product owner.
 * @param request - resolved shared service request.
 * @param spec - profile config, process service, and diagnostic sink.
 * @returns the published compatibility run.
 */
export async function startClaudeCodeRun(
  request: SubagentStartRequest,
  spec: ClaudeCodeRunSpec,
): Promise<SubagentRun> {
  const { onError, ...productSpec } = spec
  const product = await startClaudeCodeProductRun(
    textTask(request.prompt),
    {
      ...productSpec,
      ...onError === undefined ? {} : { onError: (error: Error) => { onError(error, 'error') } },
    },
    request.signal,
  )
  let locallyCancelled = false
  const result = settleRunResult({
    attempt: async (): Promise<SubagentResult> => ({
      output: [{ type: 'text', text: await product.result }],
      stopReason: 'completed',
    }),
    collectOutput: () => product.collectOutput(),
    collectDiagnostic: () => product.collectDiagnostic(),
    cancelled: () => locallyCancelled || request.signal.aborted,
    ...onError === undefined ? {} : { onError },
    signal: request.signal,
    onAbort: product.onAbort,
  })
  return subprocessRunHandle({
    id: brandString<SessionId>(randomUUID()),
    result,
    signal: request.signal,
    onAbort: product.onAbort,
    requestCancel: () => {
      locallyCancelled = true
      product.abort()
    },
    teardown: () => product.dispose(),
  })
}

/** Preserve the legacy helper's result vocabulary for existing consumers.
 * @param query - published official SDK query.
 * @param onPermissionDenied - records a safe native permission denial.
 * @param onResult - records a terminal SDK result.
 * @returns the completed compatibility result.
 */
export async function consumeClaudeQuery(
  query: AsyncIterable<SDKMessage>,
  onPermissionDenied?: () => void,
  onResult?: () => void,
): Promise<SubagentResult> {
  const text = await consumeClaudeProductQuery(query, onPermissionDenied, onResult)
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}
