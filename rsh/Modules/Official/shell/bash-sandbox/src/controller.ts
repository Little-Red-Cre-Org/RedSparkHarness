/** Bash confinement policy over the shared shell sandbox controller. */
import type { ShellExecSpec } from '@redspark/rsh-shell/native'
import type { ProcessSandbox, SandboxExecutionPolicy, SandboxMode } from '@redspark/rsh-sandbox/native'
import { SandboxShellController, type ShellCommands } from '@redspark/rsh-shell-sandbox-core'

/** Policy provider selected by the active composition. */
export interface BashPolicy {
  readonly defaultMode: SandboxMode
  resolve(): SandboxExecutionPolicy
}

/** Applies confinement to Bash commands and classifies runner outcomes. */
export class SandboxBashController extends SandboxShellController {
  /** @param local - managed Bash executor. @param sandbox - confinement runner. @param policy - current sandbox policy. */
  constructor(local: ShellCommands & { argv(spec: ShellExecSpec): readonly string[] }, sandbox: Pick<ProcessSandbox, 'confine'>, policy: BashPolicy) {
    super(local, sandbox, policy, spec => local.argv(spec))
  }
}
