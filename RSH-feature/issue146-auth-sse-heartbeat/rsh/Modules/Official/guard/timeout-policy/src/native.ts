/**
 * Native cooperative tool-call timeout policy over the selected tool registry.
 * @module @deepseek-ai/dsh-tool-call-timeout-policy/native
 */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecutionPolicy, NativeToolResult } from '@deepseek-ai/dsh-native-tools'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import { runWithToolDeadline, TOOL_TIMEOUT, TOOL_TIMEOUT_ERROR_NAME, toolTimeoutMessage } from './core.ts'

export { TOOL_TIMEOUT } from './core.ts'

/**
 * Build the result recorded when this policy's own deadline elapsed.
 * @param timeoutMs - the declared budget that elapsed.
 * @returns the same model text and error identity as the Cordis wrapper's result.
 */
export function nativeToolTimeoutResult(timeoutMs: number): NativeToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${toolTimeoutMessage(timeoutMs)}` }],
    isError: true,
    error: { name: TOOL_TIMEOUT_ERROR_NAME, code: TOOL_TIMEOUT },
  }
}

/**
 * Apply a tool's declared budget through the shared deadline enforcement.
 * @param call - admitted invocation whose signal the budget derives from.
 * @param tool - frozen declaration carrying the optional `timeoutMs` budget.
 * @param next - remaining execution chain, called once with the budgeted signal.
 * @returns the body result, or the `TOOL_TIMEOUT` result when this budget fired.
 */
export const nativeToolTimeoutPolicy: NativeToolExecutionPolicy = (call, tool, next) => {
  const { timeoutMs } = tool
  if (timeoutMs === undefined) return next(call.signal)
  return runWithToolDeadline(call.signal, timeoutMs, next, nativeToolTimeoutResult)
}

/** Install the timeout policy for every tool visible in this installation's scope. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-call-timeout-policy', targets: ['host'],
  requires: ['tools'], provides: [],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('timeout-policy: native configuration must be empty')
    }
    return (context) => {
      context.effect(context.require('tools').aroundExecution(nativeToolTimeoutPolicy, context.scope))
    }
  },
}
