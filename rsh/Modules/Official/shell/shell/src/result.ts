/** Lossless foreground shell result projection shared by tool consumers. */
import type { ShellRunResult } from './types.ts'

/**
 * Copy the declared executor fields into a JSON result, omitting absent optional fields.
 * @param result - completed command output and independent exit, timeout and sandbox facts.
 * @returns the detached foreground result without provider-owned extra properties.
 */
export function canonicalShellResult(result: ShellRunResult): ShellRunResult {
  const output = (stream: ShellRunResult['stdout']) => ({
    text: stream.text, truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut,
    aborted: result.aborted, timeoutMs: result.timeoutMs,
    stdout: output(result.stdout), stderr: output(result.stderr),
    ...result.sandbox !== undefined ? { sandbox: {
      mode: result.sandbox.mode, denied: result.sandbox.denied,
      ...result.sandbox.enforcement !== undefined ? { enforcement: result.sandbox.enforcement } : {},
      ...result.sandbox.runnerFailed !== undefined ? { runnerFailed: result.sandbox.runnerFailed } : {},
    } } : {},
  }
}
