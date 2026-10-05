/** PowerShell confinement policy over the shared shell sandbox controller. */
import type { ProcessSandbox, SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox/native'
import { SandboxShellController } from '@deepseek-ai/dsh-shell-sandbox-core'
import { LocalPwshController } from '@deepseek-ai/dsh-pwsh-local/native'

/** Policy provider selected by the active composition. */
export interface PwshPolicy {
  readonly defaultMode: SandboxMode
  resolve(): SandboxExecutionPolicy
}

/** Applies confinement to PowerShell commands and classifies runner outcomes. */
export class SandboxPwshController extends SandboxShellController {
  /** @param local - managed PowerShell executor. @param sandbox - confinement runner. @param policy - current sandbox policy. */
  constructor(local: LocalPwshController, sandbox: ProcessSandbox, policy: PwshPolicy) {
    super(local, sandbox, policy, spec => local.argv(spec))
  }
}
