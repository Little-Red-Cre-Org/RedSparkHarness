/**
 * Framework-free tool-timeout enforcement shared by the Cordis wrapper and native execution policy.
 * @module @deepseek-ai/dsh-tool-call-timeout-policy/core
 */
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

/**
 * The code owned by this plugin, used BOTH as the internal deadline
 * classification code AND as the structured error `code` on the replacement
 * tool result. Scoping `timeoutOf` to it keeps a nested outer deadline
 * (another wrapper's timer that fired first) from being misread as this
 * plugin's own timeout — it reads as an ordinary upstream cancel.
 */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/** Structured error name recorded with a {@link TOOL_TIMEOUT} result. */
export const TOOL_TIMEOUT_ERROR_NAME = 'ToolTimeoutError'

/**
 * Describe an elapsed budget for both the model-facing text and the error message.
 * @param timeoutMs - the elapsed declared budget.
 * @returns the message without its model-facing `Error: ` prefix.
 */
export function toolTimeoutMessage(timeoutMs: number): string {
  return `tool call timed out after ${timeoutMs}ms`
}

/**
 * Run one dispatch under a declared budget and translate only this budget's expiry.
 * The dispatch is never raced or abandoned: the timeout outcome is produced only after it settles,
 * whether it returned the tool's own abort result or threw.
 * @param signal - caller cancellation the budget derives from.
 * @param timeoutMs - the tool's declared budget.
 * @param dispatch - the remaining chain, run once with the derived deadline signal.
 * @param timedOut - builds the runtime's `TOOL_TIMEOUT` result for the elapsed budget.
 * @returns the dispatch outcome, or the timeout result when this budget fired.
 */
export async function runWithToolDeadline<T>(
  signal: AbortSignal, timeoutMs: number, dispatch: (signal: AbortSignal) => Promise<T>, timedOut: (timeoutMs: number) => T,
): Promise<T> {
  using budget = deadline(signal, timeoutMs, TOOL_TIMEOUT)
  // Scoped by code: a nested outer deadline that fired first reads as an ordinary upstream cancel.
  const fired = (): boolean => timeoutOf(budget.signal, TOOL_TIMEOUT) !== undefined
  let result: T
  try {
    result = await dispatch(budget.signal)
  } catch (error: unknown) {
    if (fired()) return timedOut(timeoutMs)
    throw error
  }
  return fired() ? timedOut(timeoutMs) : result
}
