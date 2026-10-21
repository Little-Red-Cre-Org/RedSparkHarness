/** Failure classification shared by consumers of process sandbox runners. */
import { accessSync, constants, statSync } from 'node:fs'
import type { RunnerFailureRule } from './native-types.ts'

const EXECUTABLE_SPAWN_CODES = new Set(['EACCES', 'ENOENT'])

function isUsableWorkdir(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Attribute an executable-specific spawn failure only after ruling out an unusable caller cwd.
 * @param error - rejected subprocess spawn.
 * @param runnerProgram - argv[0] that establishes confinement.
 * @param workdir - caller-owned process directory.
 * @returns whether ENOENT/EACCES and the error path or syscall identify the runner.
 */
export function isRunnerSpawnFailure(error: unknown, runnerProgram: string | undefined, workdir: string): boolean {
  if (runnerProgram === undefined || !isUsableWorkdir(workdir)) return false
  if (typeof error !== 'object' || error === null) return false
  const { code, path, syscall } = error as { code?: unknown; path?: unknown; syscall?: unknown }
  if (typeof code !== 'string' || !EXECUTABLE_SPAWN_CODES.has(code)) return false
  if (typeof syscall !== 'string') return false
  const exactSyscall = `spawn ${runnerProgram}`
  if (path === undefined) return syscall === exactSyscall
  if (typeof path !== 'string' || path.length === 0 || path !== runnerProgram) return false
  return syscall === 'spawn' || syscall === exactSyscall
}

/**
 * Match a failed process outcome against the selected backend's runner diagnostics.
 * @param exitCode - nonzero code required for a runner failure; null denotes a signal.
 * @param stderr - retained stderr text.
 * @param rules - backend-specific exit and fatal-line evidence.
 * @returns the first fatal line, or undefined without sufficient runner evidence.
 */
export function classifyRunnerFailure(
  exitCode: number | null,
  stderr: string,
  rules: readonly RunnerFailureRule[],
): { detail: string } | undefined {
  if (exitCode === null || exitCode === 0) return undefined
  const lines = stderr.split(/\r?\n/)
  for (const rule of rules) {
    if (rule.allowedExitCodes !== undefined && !rule.allowedExitCodes.includes(exitCode)) continue
    const informationalLines = new Set((rule.informationalLines ?? []).map(line => line.toLowerCase()))
    const fatalSignatures = rule.fatalSignatures
      .filter(signature => signature.trim().length > 0)
      .map(signature => signature.toLowerCase())
    for (const line of lines) {
      const lowered = line.toLowerCase()
      if (informationalLines.has(lowered)) continue
      if (fatalSignatures.some(signature => lowered.includes(signature))) return { detail: line }
    }
  }
  return undefined
}
