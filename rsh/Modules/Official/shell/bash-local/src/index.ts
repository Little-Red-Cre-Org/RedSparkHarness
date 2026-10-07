/**
 * Cordis adapter for the managed local Bash controller. Settings own the
 * current budget source; subprocess owns background process teardown.
 * @module @deepseek-ai/dsh-bash-local
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SHELL_SETTINGS_NAMESPACE, ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
import { LocalBashController, assertServiceableBashConfig, resolveConfig } from './controller.ts'
import type { Config, ResolvedConfig } from './controller.ts'

export { ENV_OVERRIDES, assertServiceableBashConfig } from './controller.ts'
export type { Config } from './controller.ts'

/** Local Bash service over Cordis subprocess and optional live settings. */
export class LocalBashExecutor extends ShellExecutor {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    cwd: z.string(),
    bashPath: z.string().default('bash'),
    timeoutMs: z.number().default(120_000),
    maxTimeoutMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(64_000),
    maxSpillBytes: z.number().default(64 * 1024 * 1024),
    graceMs: z.number().default(3_000),
  })

  private source: () => ResolvedConfig
  private readonly controller: LocalBashController

  /** Validated budgets from the current settings section. */
  get config(): ResolvedConfig { return this.source() }

  constructor(ctx: Context, config: Config) {
    super(ctx)
    const entry = resolveConfig(config)
    assertServiceableBashConfig(entry)
    this.source = () => entry
    this.controller = new LocalBashController(ctx.subprocess, () => this.source(), (proc, stderr, rejected, error) => {
      this.onProcessDone(proc, stderr, rejected, error)
    })
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, SHELL_SETTINGS_NAMESPACE, LocalBashExecutor.Config, entry, {
        validate: assertServiceableBashConfig,
        setSource: (current) => { this.source = current as () => ResolvedConfig },
        onChange: () => {},
      })
    })
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    return this.controller.resolve(request)
  }

  /**
   * Select the same configured executable used by foreground and background commands.
   * @param spec - resolved command.
   * @returns exact argv for confinement.
   */
  argv(spec: ShellExecSpec): readonly string[] { return this.controller.argv(spec) }

  override run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return this.controller.run(spec)
  }

  /** Run a sandbox provider's argv with the shared foreground mechanics. */
  protected runArgv(spec: ShellExecSpec, argv: readonly string[]): Promise<ShellRunResult> {
    return this.controller.runArgv(spec, argv)
  }

  override start(spec: ShellExecSpec): ShellProcess {
    return this.controller.start(spec)
  }

  /** Start a sandbox provider's argv with the shared background mechanics. */
  protected startArgv(spec: ShellExecSpec, argv: readonly string[]): ShellProcess {
    return this.controller.startArgv(spec, argv)
  }

  /**
   * Called after a background process settles and before its done promise resolves.
   * @param _proc - settled handle.
   * @param _stderr - retained stderr for sandbox classification.
   * @param _providerRejected - whether subprocess rejected without an outcome.
   * @param _providerError - provider's rejection value.
   */
  protected onProcessDone(_proc: ShellProcess, _stderr: string, _providerRejected: boolean, _providerError?: unknown): void {}
}

export default LocalBashExecutor
