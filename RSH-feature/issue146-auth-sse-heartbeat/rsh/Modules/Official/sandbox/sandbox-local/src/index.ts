/**
 * Cordis adapter for the shared local process-sandbox backend.
 * @module @deepseek-ai/dsh-sandbox-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox/native'
import { LocalSandboxBackend, resolveConfig } from './backend.ts'
import type { Config, SandboxInternals } from './backend.ts'

export type { Config, SandboxInternals } from './backend.ts'

/** Cordis Provider delegating runner selection and grant ownership to the shared backend. */
export class LocalSandboxProvider extends SandboxProvider {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    runnerCommand: z.array(z.string()).default([]),
    runnerFailureSignatures: z.array(z.string()).default([]),
    probeTimeoutMs: z.natural().default(5_000),
  })

  private readonly backend: LocalSandboxBackend

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.backend = new LocalSandboxBackend(resolveConfig(config), (failures) => {
      ctx.logger.warn(`sandbox-local: windows-acl grant cleanup completed with ${failures.length} failure(s)`)
      for (const error of failures) ctx.logger.warn(error)
    })
    ctx.effect(() => () => { this.backend.dispose() })
  }

  /** Probe and runner overrides used by tests of the platform chains. */
  get internals(): SandboxInternals { return this.backend.internals }
  set internals(value: SandboxInternals) { this.backend.internals = value }

  /**
   * Wrap an exact argv under the requested file-effect policy.
   * @param argv - original program and arguments.
   * @param policy - complete confined policy for this call.
   * @returns runner argv, enforcement, denial signatures and runner-failure rules.
   */
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    return this.backend.confine(argv, policy)
  }

  /**
   * Prepare the existing session temp capability for a confined runtime home.
   * @param policy - complete per-call file policy.
   * @returns the Windows session temp root used by `confine`, when available.
   */
  prepareWritableTempRoot(policy: SandboxPolicy): string | undefined {
    return this.backend.prepareWritableTempRoot(policy)
  }
}

export default LocalSandboxProvider
