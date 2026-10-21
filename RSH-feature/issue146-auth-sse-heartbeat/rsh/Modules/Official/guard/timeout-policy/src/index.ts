/**
 * Cooperative tool-call timeout enforcer. A tool declares `timeoutMs` and
 * promises to honor `exec.signal`; this wrapper arms that deadline and maps its
 * own expiry to `TOOL_TIMEOUT` without racing or abandoning the tool promise.
 *
 * FIXME: settle the intended `@deepseek-ai/dsh-timeout-guard` rename before the
 * first tagged release — suggestion only, aligning the name with its `guard/`
 * home; decide at resolution time
 * ([regrouping Agent Note](../../../../../../.agents/notes/archived/architecture/2026-07-29-package-regrouping.md)).
 *
 * @module @deepseek-ai/dsh-tool-call-timeout-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { runWithToolDeadline, TOOL_TIMEOUT, TOOL_TIMEOUT_ERROR_NAME, toolTimeoutMessage } from './core.ts'

export { TOOL_TIMEOUT } from './core.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'timeout-policy'

/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export const inject = ['tools']

/**
 * The structured result substituted when this plugin's deadline wins. `content`
 * is the model-facing message; `error.code` is the same {@link TOOL_TIMEOUT}
 * this plugin owns, so a retry/sandbox plugin (and replay) can route on it.
 *
 * @param timeoutMs - the elapsed budget, rendered into the model-facing message.
 * @returns the `isError` {@link ToolExecutionResult} with a `TOOL_TIMEOUT` error.
 */
function toolTimeoutResult(timeoutMs: number): ToolExecutionResult {
  const message = toolTimeoutMessage(timeoutMs)
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: TOOL_TIMEOUT_ERROR_NAME, code: TOOL_TIMEOUT } },
  }
}

/**
 * Register the timeout wrapper. It resolves the caller-visible tool definition,
 * temporarily replaces `exec.signal`, delegates, restores the upstream signal,
 * and replaces the result only when this wrapper's own timer fired.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const timeoutMs = ctx.tools.get(exec.name, exec.agent)?.timeoutMs
    // A tool that declares no budget: no deadline, delegate unchanged.
    if (timeoutMs === undefined) return next()
    // Cordis `next()` ignores arguments, so the derived deadline is swapped onto exec for dispatch,
    // then the caller's own signal is restored so post-execute listeners never see this plugin's
    // (possibly already-aborted) timeout signal.
    const upstream = exec.signal
    return runWithToolDeadline(upstream, timeoutMs, async (signal) => {
      exec.signal = signal
      try { return await next() } finally { exec.signal = upstream }
    }, toolTimeoutResult)
  })
}
