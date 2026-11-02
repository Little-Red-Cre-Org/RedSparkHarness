/** PowerShell confinement policy over the shared shell sandbox controller. */
import type { ProcessSandbox, SandboxExecutionPolicy, SandboxMode } from '@redspark/rsh-sandbox/native'
import { SandboxShellController } from '@redspark/rsh-shell-sandbox-core'
import { LocalPwshController } from '@redspark/rsh-pwsh-local/native'

/** Policy provider selected by the active composition. */
export interface PwshPolicy {
  readonly defaultMode: SandboxMode
  resolve(): SandboxExecutionPolicy
}

/** Applies confinement to PowerShell commands and classifies runner outcomes. */
export class SandboxPwshController extends SandboxShellController {
  /** @param local - managed PowerShell executor. @param sandbox - confinement runner. @param policy - current sandbox policy. */
  constructor(local: LocalPwshController, sandbox: Pick<ProcessSandbox, 'confine'>, policy: PwshPolicy) {
    super(local, sandbox, policy, spec => local.argv(spec))
  }
}
