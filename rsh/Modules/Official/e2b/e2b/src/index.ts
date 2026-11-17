/**
 * Cordis adapter for the shared E2B sandbox owner.
 * @module @redspark/rsh-e2b
 */

import { Context, Service } from '@redspark/cordis'
import z from '@redspark/schemastery'
import type { Sandbox } from 'e2b'
import { E2BSandboxOwner, type Config } from './owner.ts'

export {
  CommandExitError,
  FileNotFoundError,
  FileType,
  Sandbox,
  SandboxNotFoundError,
} from 'e2b'
export type { CommandHandle, CommandResult, EntryInfo } from 'e2b'
export { e2bControlEnvs, quoteE2BShellArg, E2BSandboxOwner } from './owner.ts'
export type { Config, E2BSandboxAccess, ResolvedE2BSandboxConfig } from './owner.ts'

declare module '@redspark/cordis' {
  interface Context {
    e2b: E2BRuntime
  }
}

/**
 * Cordis registration of the shared E2B sandbox owner.
 * Adapters await {@link getSandbox}; disposal deletes the sandbox.
 */
export class E2BRuntime extends Service {
  static Config: z<Config> = z.object({
    apiKey: z.string(),
    cwd: z.string().default('/home/user/workspace'),
    timeoutMs: z.number().default(300_000),
  })

  /** Validated remote working directory shared by provider adapters. */
  readonly cwd: string
  /** Remote directory reserved for adapter-owned process and terminal state. */
  readonly runtimeRoot: string

  private readonly owner: E2BSandboxOwner

  /**
   * Start the shared sandbox and delete it when this service disposes.
   * @param ctx - Cordis context that receives the `e2b` service.
   * @param config - sandbox key, cwd, and lifetime; schema defaults fill cwd and timeout.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'e2b')
    this.owner = new E2BSandboxOwner(config)
    this.cwd = this.owner.cwd
    this.runtimeRoot = this.owner.runtimeRoot
    ctx.effect(() => () => this.owner.dispose(), 'e2b sandbox teardown')
  }

  /**
   * Return the shared live SDK handle.
   * @returns the created sandbox after the configured cwd exists.
   * @throws when E2B rejects creation or the service is disposing.
   */
  getSandbox(): Promise<Sandbox> {
    return this.owner.getSandbox()
  }
}

export default E2BRuntime
