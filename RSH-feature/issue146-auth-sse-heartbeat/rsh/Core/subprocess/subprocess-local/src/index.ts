/** Cordis adapter for the shared local subprocess implementation. */
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { LocalSubprocessController } from './controller.ts'
import type { SpawnInternals } from './spawn.ts'
import type { ProcessInspector } from './process-inspector.ts'

/** Legacy Cordis registration over the same process owner used by the native Provider. */
export class LocalSubprocessRuntime extends SubprocessRuntime {
  private readonly controller: LocalSubprocessController

  constructor(ctx: Context) {
    super(ctx)
    this.controller = new LocalSubprocessController((message) => { ctx.logger.warn(message) })
    ctx.effect(() => () => this.controller.dispose(), 'local subprocess teardown')
  }

  /** Compatibility access for existing lifecycle probes. */
  get live(): LocalSubprocessController['live'] { return this.controller.live }
  /** Compatibility access for existing terminal lifecycle probes. */
  get terminals(): LocalSubprocessController['terminals'] { return this.controller.terminals }

  /** Test hook forwarded to the local process launcher. */
  get internals(): SpawnInternals { return this.controller.internals }
  set internals(value: SpawnInternals) { this.controller.internals = value }

  /** Test hook for terminal process inspection. */
  get terminalInspector(): ProcessInspector | undefined { return this.controller.terminalInspector }
  set terminalInspector(value: ProcessInspector | undefined) { this.controller.terminalInspector = value }

  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    return this.controller.resolveExecutable(command, env, signal)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle { return this.controller.spawn(spec) }

  spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return this.controller.spawnTerminal(spec)
  }

  /**
   * Compatibility access for executable lookup probes.
   * @param command - bare executable name.
   * @param env - child environment used for PATH resolution.
   * @returns absolute candidate paths in search order.
   */
  executableCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
    return this.controller.executableCandidates(command, env)
  }

  /**
   * Compatibility access for platform containment probes.
   * @param kind - ordinary child or terminal session.
   * @returns the selected platform owner or explicit fallback.
   */
  selectContainmentMode(kind: 'ordinary' | 'terminal'): 'linux-scope' | 'windows-job' | 'fallback' {
    return this.controller.selectContainmentMode(kind)
  }

  /**
   * Compatibility access for fallback-warning probes.
   * @param platform - selected execution platform.
   * @param kind - ordinary child or terminal session.
   * @param selectedReason - detected reason when one is available.
   */
  warnFallback(platform: NodeJS.Platform, kind: 'ordinary' | 'terminal', selectedReason?: string): void {
    this.controller.warnFallback(platform, kind, selectedReason)
  }
}

export default LocalSubprocessRuntime
