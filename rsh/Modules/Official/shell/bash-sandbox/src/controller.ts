/** Bash confinement policy over the shared shell sandbox controller. */
import type { ShellExecSpec } from '@deepseek-ai/dsh-shell/native'
import type { ProcessSandbox, SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox/native'
import { SandboxShellController, type ShellCommands } from '@deepseek-ai/dsh-shell-sandbox-core'

/** Policy provider selected by the active composition. */
export interface BashPolicy {
  readonly defaultMode: SandboxMode
  resolve(): SandboxExecutionPolicy
}

/** Applies confinement to Bash commands and classifies runner outcomes. */
export class SandboxBashController extends SandboxShellController {
  /** @param local - managed Bash executor. @param sandbox - confinement runner. @param policy - current sandbox policy. */
  constructor(local: ShellCommands & { argv(spec: ShellExecSpec): readonly string[] }, sandbox: ProcessSandbox, policy: BashPolicy) {
    super(local, sandbox, policy, spec => local.argv(spec))
  }
}
