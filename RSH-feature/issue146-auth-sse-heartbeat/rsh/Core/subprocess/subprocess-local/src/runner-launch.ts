/** Parent-side invocation and bootstrap state for the private native runner. */

import type { StdioOptions } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { extname, isAbsolute } from 'node:path'
import { inspect } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess/native'
import { childEnv, subprocessEnvironment } from './spawn.ts'

/** The one private environment variable consumed before target state is restored. */
export const SUBPROCESS_RUNNER_ENV = 'DSH_SUBPROCESS_RUNNER' as const

/** Sentinel used by the packaged bootstrap for the Windows IPC runner. */
export const WINDOWS_RUNNER_SELECTION = 'windows' as const

/** Non-empty command tuple used to launch the private runner entry. */
export type RunnerInvocation = [string, ...string[]]

const SOURCE_TSCONFIG_PATH = fileURLToPath(new URL('../../../../../tsconfig.base.json', import.meta.url))
const RUNNER_CONTROL_ENV_PREFIXES = ['NODE_', 'TSX_'] as const

/**
 * Resolve the source, built, or packaged entry that calls the same runner core.
 * @returns executable and arguments for the active runtime form.
 */
export function spawnRunnerInvocation(): RunnerInvocation {
  if ('pkg' in process) return [process.execPath]
  /* v8 ignore next -- built-artifact smoke imports the emitted JavaScript runner entry;
   * source-unit coverage cannot change import.meta.url. */
  if (extname(fileURLToPath(import.meta.url)) !== '.ts') {
    return [process.execPath, fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-subprocess-local/runner'))]
  }
  return [
    process.execPath,
    '--import',
    import.meta.resolve('tsx/esm'),
    fileURLToPath(new URL('./bin.ts', import.meta.url)),
  ]
}

/**
 * Check the concrete runner executable and entry paths without executing a probe mode.
 * @param invocation - resolved executable and runner-entry arguments.
 * @returns whether every concrete executable or entry path is accessible.
 */
export function runnerInvocationAvailable(invocation: RunnerInvocation = spawnRunnerInvocation()): boolean {
  try {
    if (isAbsolute(invocation[0])) accessSync(invocation[0], fsConstants.X_OK)
    const entry = invocation.at(-1)
    if (entry !== undefined && entry !== invocation[0] && isAbsolute(entry)) {
      accessSync(entry, fsConstants.R_OK)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Build the bootstrap-safe environment; target overrides arrive through request/IPC.
 * @param selection - private runner selector or Linux launch-request locator.
 * @param invocation - resolved runner invocation whose source form needs the workspace paths map.
 * @returns environment for the runner before target state is restored.
 */
export function runnerEnvironment(
  selection: string,
  invocation?: RunnerInvocation,
): NodeJS.ProcessEnv {
  const entry = invocation?.at(-1)
  const env = childEnv()
  for (const name of Object.keys(env)) {
    const normalized = name.toUpperCase()
    if (RUNNER_CONTROL_ENV_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
      Reflect.deleteProperty(env, name)
    }
  }
  return {
    ...env,
    [SUBPROCESS_RUNNER_ENV]: selection,
    SYSTEMD_LOG_TARGET: 'null',
    ...entry?.endsWith('.ts') === true ? { TSX_TSCONFIG_PATH: SOURCE_TSCONFIG_PATH } : {},
  }
}

/**
 * Read and delete the private selector before importing or restoring target state.
 * @param env - mutable environment containing the private selector.
 * @returns the consumed selector, or undefined when no runner was requested.
 */
export function consumeRunnerSelection(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const selection = env[SUBPROCESS_RUNNER_ENV]
  Reflect.deleteProperty(env, SUBPROCESS_RUNNER_ENV)
  return selection
}

/**
 * Require the private argv delimiter and at least one target argv entry.
 * @param argv - private runner arguments.
 * @returns copied target argv after the private delimiter.
 */
export function parseRunnerTargetArgv(argv: readonly string[]): string[] {
  if (argv[0] !== '--' || argv.length < 2) {
    throw new Error('subprocess runner requires target argv after a private -- delimiter')
  }
  return [...argv.slice(1)]
}

/**
 * Build direct Linux target stdio, or isolated Windows runner stdio with IPC
 * on fd 3 and target carriers on fd 4 through fd 6.
 * @param spec - ordinary subprocess request whose stdio modes are preserved.
 * @param ipc - whether to isolate the runner and add its private Node IPC descriptor.
 * @param stdinCarrier - runner fd 4 carrier; Windows ignore passes an opened null-device fd.
 * @returns child-process stdio options for the runner.
 */
export function runnerStdio(
  spec: SubprocessSpawnSpec,
  ipc: boolean,
  stdinCarrier: 'pipe' | number = 'pipe',
): StdioOptions {
  const targetStdio: StdioOptions = [
    spec.stdio.stdin === 'ignore' ? 'ignore' : 'pipe',
    spec.stdio.stdout === 'inherit' ? 'inherit' : 'pipe',
    spec.stdio.stderr === 'inherit' ? 'inherit' : 'pipe',
  ]
  if (!ipc) return targetStdio
  return [
    'ignore',
    'ignore',
    'ignore',
    'ipc',
    stdinCarrier,
    spec.stdio.stdout === 'inherit' ? 1 : 'pipe',
    spec.stdio.stderr === 'inherit' ? 2 : 'pipe',
  ]
}

export { resolveWindowsExecutable } from '@deepseek-ai/dsh-win32-process'

function throwNullByteError(property: string, value: string, argument: boolean): never {
  const subject = argument ? `The argument '${property}'` : `The property '${property}'`
  const error = new TypeError(`${subject} must be a string without null bytes. Received ${inspect(value)}`)
  Object.assign(error, { code: 'ERR_INVALID_ARG_VALUE' })
  throw error
}

function validateNoNullByte(property: string, value: string, argument = false): void {
  if (value.includes('\0')) throwNullByteError(property, value, argument)
}

/**
 * Materialize and synchronously validate the final target environment.
 * @param spec - final target argv, cwd, and environment overrides.
 * @returns complete target environment after Node-equivalent validation.
 */
export function targetEnvironment(
  spec: Pick<SubprocessSpawnSpec, 'argv' | 'cwd' | 'env' | 'envMode'>,
): Record<string, string> {
  spec.argv.forEach((value, index) => {
    validateNoNullByte(index === 0 ? 'file' : `args[${String(index - 1)}]`, value, true)
  })
  validateNoNullByte('options.cwd', spec.cwd)
  const env = subprocessEnvironment(spec)
  for (const [key, value] of Object.entries(env)) {
    validateNoNullByte(`options.env['${key}']`, key)
    validateNoNullByte(`options.env['${key}']`, value)
  }
  return env
}
