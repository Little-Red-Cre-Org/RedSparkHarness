/**
 * Internal sandbox-result classification helpers.
 *
 * @module @deepseek-ai/dsh-bash-sandbox/helpers
 */

import type { ShellRunResult } from '@deepseek-ai/dsh-shell/native'
export { classifyRunnerFailure, isRunnerSpawnFailure } from '@deepseek-ai/dsh-sandbox/native'

/**
 * Classify a failed run against the selected backend's denial dialect.
 * @param result - settled foreground run.
 * @param signatures - case-insensitive denial substrings from the active wrap.
 * @returns whether the failed run matches that denial dialect.
 */
export function classifyDenial(result: ShellRunResult, signatures: readonly string[]): boolean {
  return matchesSignature(result.exitCode, result.stderr.text, signatures)
}

/**
 * Match a non-zero exit against case-insensitive stderr signatures.
 * @param exitCode - process exit code; null means signal termination.
 * @param stderr - collected stderr text.
 * @param signatures - substrings identifying the selected backend's dialect.
 * @returns whether this is a non-zero exit whose stderr matches a signature.
 */
export function matchesSignature(exitCode: number | null, stderr: string, signatures: readonly string[]): boolean {
  if (exitCode === null || exitCode === 0) return false
  const lowered = stderr.toLowerCase()
  return signatures.some(signature => lowered.includes(signature.toLowerCase()))
}
