/** Local Bash shell policy over the shared managed process controller. */
import type { ShellExecSpec, ShellProcess } from '@deepseek-ai/dsh-shell/native'
import type { SubprocessOperations } from '@deepseek-ai/dsh-subprocess/native'
import {
  LocalShellController, assertServiceableConfig, resolveConfig as resolveLocalConfig,
  type Config as LocalConfig, type ResolvedConfig as ResolvedLocalConfig,
} from '@deepseek-ai/dsh-shell-process-local'

/** Terminal defaults applied before caller and trusted DSH environment. */
export const ENV_OVERRIDES = {
  NO_COLOR: '1', TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat',
} as const

/** Configurable Bash execution budgets. */
export interface Config extends LocalConfig {
  /** Explicit Bash executable; omitted configuration selects bash in the execution world. */
  bashPath?: string
}
/** Bash budgets after native profile validation. */
export type ResolvedConfig = ResolvedLocalConfig & { bashPath: string }

/** Reject unusable budgets before a process can start.
 * @param config - resolved Bash budgets.
 */
export function assertServiceableBashConfig(config: Config): void {
  assertServiceableConfig('bash-local', config)
  if (config.bashPath !== undefined && config.bashPath.trim().length === 0) {
    throw new Error('bash-local: bashPath must be a nonempty executable')
  }
}

/** Validate native Bash Provider configuration.
 * @param input - untrusted profile configuration.
 * @returns resolved Bash budgets.
 */
export function resolveConfig(input: unknown): ResolvedConfig {
  const base = resolveLocalConfig(input, 'bash-local', ['bashPath'])
  const fields = input === undefined ? undefined : input as Record<string, unknown>
  const bashPath = fields?.bashPath === undefined ? 'bash' : fields.bashPath
  if (typeof bashPath !== 'string' || bashPath.trim().length === 0) {
    throw new Error('bash-local: bashPath must be a nonempty executable')
  }
  return { ...base, bashPath }
}

/** Local Bash executor for Cordis and native Providers. */
export class LocalBashController extends LocalShellController {
  /**
   * @param subprocess - managed process owner.
   * @param bashConfigSource - validated current budgets and executable.
   * @param onProcessDone - settlement hook.
   */
  constructor(
    subprocess: SubprocessOperations,
    private readonly bashConfigSource: () => ResolvedConfig,
    onProcessDone: (proc: ShellProcess, stderr: string, rejected: boolean, error?: unknown) => void = () => {},
  ) {
    super(subprocess, bashConfigSource, {
      label: 'bash-local', timeoutCode: 'BASH_TIMEOUT', envOverrides: ENV_OVERRIDES,
      argv: spec => [bashConfigSource().bashPath, '-c', spec.command],
    }, onProcessDone)
  }

  /**
   * Select exact Bash argv before the sandbox Provider wraps it.
   * @param spec - resolved shell command.
   * @returns configured executable and unmodified command arguments.
   */
  argv(spec: ShellExecSpec): readonly string[] {
    return [this.bashConfigSource().bashPath, '-c', spec.command]
  }
}
