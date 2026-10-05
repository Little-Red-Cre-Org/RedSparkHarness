/** Local PowerShell policy over the shared managed process controller. */
import type { ShellExecSpec, ShellProcess } from '@deepseek-ai/dsh-shell/native'
import type { SubprocessOperations } from '@deepseek-ai/dsh-subprocess/native'
import {
  LocalShellController, assertServiceableConfig, resolveConfig as resolveLocalConfig,
  type Config as LocalConfig, type ResolvedConfig as ResolvedLocalConfig,
} from '@deepseek-ai/dsh-shell-process-local'
import { resolvePwshPath } from './resolve.ts'

/** UTF-8 output for Windows PowerShell 5.1 and pwsh 7. */
export const ENCODING_PREAMBLE =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

/** PowerShell terminal defaults without POSIX TERM. */
export const ENV_OVERRIDES = { NO_COLOR: '1', PAGER: 'cat', GIT_PAGER: 'cat' } as const

/** Native PowerShell budgets and executable choice. */
export interface Config extends LocalConfig {
  /** Explicit PowerShell executable; absent probes Windows installation locations. */
  pwshPath?: string
}

/** PowerShell config after budget validation. */
export type ResolvedConfig = ResolvedLocalConfig & Pick<Config, 'pwshPath'>

/** Reject unusable PowerShell budgets before a process can start.
 * @param config - resolved PowerShell budgets.
 */
export function assertServiceablePwshConfig(config: Config): void {
  assertServiceableConfig('pwsh-local', config)
}

/** Validate native PowerShell Provider configuration.
 * @param input - untrusted profile configuration.
 * @returns resolved PowerShell budgets and executable choice.
 */
export function resolveConfig(input: unknown): ResolvedConfig {
  const base = resolveLocalConfig(input, 'pwsh-local', ['pwshPath'])
  if (input === undefined) return base
  const values = input as Record<string, unknown>
  if (values.pwshPath !== undefined && (typeof values.pwshPath !== 'string' || values.pwshPath.trim().length === 0)) {
    throw new Error('pwsh-local: pwshPath must be a nonempty executable')
  }
  return { ...base, ...values.pwshPath === undefined ? {} : { pwshPath: values.pwshPath } }
}

/** Local PowerShell executor for the native Provider. */
export class LocalPwshController extends LocalShellController {
  /** Executable selected for this immutable native Provider. */
  readonly pwshPath: string
  private readonly commandArgv: (spec: ShellExecSpec) => readonly string[]

  /** @param subprocess - managed process owner. @param configSource - validated current budgets. @param onProcessDone - settlement hook. */
  constructor(
    subprocess: SubprocessOperations,
    configSource: () => ResolvedConfig,
    onProcessDone: (proc: ShellProcess, stderr: string, rejected: boolean, error?: unknown) => void = () => {},
  ) {
    const pwshPath = resolvePwshPath(configSource().pwshPath)
    const argv = (spec: ShellExecSpec) => [pwshPath, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `${ENCODING_PREAMBLE}${spec.command}`]
    super(subprocess, configSource, {
      label: 'pwsh-local', timeoutCode: 'PWSH_TIMEOUT', envOverrides: ENV_OVERRIDES, argv,
    }, onProcessDone)
    this.pwshPath = pwshPath
    this.commandArgv = argv
  }

  /** PowerShell invocation suitable for a confinement runner.
   * @param spec - resolved shell command.
   * @returns exact executable and arguments.
   */
  argv(spec: ShellExecSpec): readonly string[] { return this.commandArgv(spec) }
}
