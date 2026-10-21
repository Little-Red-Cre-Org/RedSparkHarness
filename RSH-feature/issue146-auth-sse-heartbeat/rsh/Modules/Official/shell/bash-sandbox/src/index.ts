/**
 * Cordis adapter for the sandbox-consuming Bash controller. The configured
 * policy and runner remain owned by their respective services.
 * @module @deepseek-ai/dsh-bash-sandbox
 */
import { Context } from '@deepseek-ai/cordis'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import { SandboxBashController } from './controller.ts'

/** Local Bash budgets; sandbox policy and runner selection belong to their providers. */
export type Config = LocalConfig

/** Registers the shared confining controller as the Cordis shell service. */
export class SandboxBashExecutor extends LocalBashExecutor {
  static override inject = ['subprocess', 'sandbox', 'sandboxPolicy']

  private readonly sandboxController: SandboxBashController

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.sandboxController = new SandboxBashController({
      get sandboxMode() { return undefined },
      resolve: request => super.resolve(request),
      argv: spec => this.argv(spec),
      run: spec => super.run(spec),
      start: spec => super.start(spec),
      runArgv: (spec, argv) => this.runArgv(spec, argv),
      startArgv: (spec, argv) => this.startArgv(spec, argv),
    }, ctx.sandbox, ctx.sandboxPolicy)
  }

  override get sandboxMode() { return this.sandboxController.sandboxMode }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    return this.sandboxController.resolve(request)
  }

  override run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return this.sandboxController.run(spec)
  }

  override start(spec: ShellExecSpec): ShellProcess {
    return this.sandboxController.start(spec)
  }

  protected override onProcessDone(proc: ShellProcess, stderr: string, providerRejected: boolean, providerError?: unknown): void {
    this.sandboxController.onProcessDone(proc, stderr, providerRejected, providerError)
  }
}

export default SandboxBashExecutor
