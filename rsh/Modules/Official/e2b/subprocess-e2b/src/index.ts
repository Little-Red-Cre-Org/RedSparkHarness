/**
 * Cordis adapter for the E2B subprocess backend.
 * @module @redspark/rsh-subprocess-e2b
 */

import { Context } from '@redspark/cordis'
import type {} from '@redspark/rsh-e2b'
import z from '@redspark/schemastery'
import { SubprocessRuntime } from '@redspark/rsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@redspark/rsh-subprocess'
import { E2BSubprocessBackend } from './backend.ts'
import type { E2BSubprocessHandle } from './process.ts'

/** Configuration for the E2B subprocess adapter. */
export interface Config {
  /** Remote status/liveness poll cadence in milliseconds; each tick is one control-plane request. */
  pollMs?: number
}

interface SchemaResolvedConfig extends Config {
  pollMs: number
}

/** Cordis registration of the E2B subprocess backend as `ctx.subprocess`. */
export class E2BSubprocessRuntime extends SubprocessRuntime {
  static inject = ['e2b']

  static Config: z<Config> = z.object({
    pollMs: z.number().default(20),
  })

  private readonly backend: E2BSubprocessBackend

  /**
   * Handles still owned by teardown.
   * @returns the backend's live process set.
   */
  get live(): Set<E2BSubprocessHandle> {
    return this.backend.live
  }

  /**
   * Create the E2B subprocess service and bind its disposal policy.
   * @param ctx - Cordis context whose `e2b` service owns the sandbox.
   * @param config - poll cadence; the schema fills the default before construction.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery fills pollMs before construction; the type does not encode that step.
    const { pollMs } = config as SchemaResolvedConfig
    this.backend = new E2BSubprocessBackend(ctx.e2b, pollMs)
    ctx.effect(() => () => this.backend.dispose(), 'e2b subprocess teardown')
  }

  /** @inheritdoc */
  resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.backend.resolveExecutable(command, env, signal)
  }

  /** @inheritdoc */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    return this.backend.spawn(spec)
  }

  /** @inheritdoc */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return this.backend.spawnTerminal(spec)
  }
}

export default E2BSubprocessRuntime
