/**
 * Persistent shell PTY backend over the subprocess terminal primitive, shared
 * sandbox policy, bounded output, and provider-owned session cleanup.
 * @module @deepseek-ai/dsh-terminal-bash
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TerminalBackendCleanupError } from '@deepseek-ai/dsh-terminal'
import type { TerminalBackend, TerminalBackendSpawnSpec } from '@deepseek-ai/dsh-terminal'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-projection'
import { type Config, type ResolvedConfig, resolveConfig, validateConfig } from './config.ts'
import { LocalPtySession } from './session.ts'
import { childEnvironment, startupSession } from './startup.ts'
export { PWSH_PROMPT_SETUP } from './startup.ts'

export { Config } from './config.ts'
export type { Config as TerminalLocalConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'terminal-bash'
/** Required services: terminal registry, shared confinement policy, projection registry, and process substrate. */
export const inject = ['terminals', 'sandboxPolicy', 'sessionProjections', 'subprocess']

interface SandboxModeFenceState {
  pty: Context['terminals']
  sandboxPolicy: Context['sandboxPolicy']
  sessionProjections: Context['sessionProjections']
}

const sandboxModeFences = new WeakMap<Agent, SandboxModeFenceState>()

function ensureSandboxModeFence(ctx: Context, owner: Agent): void {
  const existing = sandboxModeFences.get(owner)
  if (existing !== undefined) {
    existing.pty = ctx.terminals
    existing.sandboxPolicy = ctx.sandboxPolicy
    existing.sessionProjections = ctx.sessionProjections
    return
  }
  const state: SandboxModeFenceState = {
    pty: ctx.terminals,
    sandboxPolicy: ctx.sandboxPolicy,
    sessionProjections: ctx.sessionProjections,
  }
  sandboxModeFences.set(owner, state)
  owner.ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (session !== owner.session || event.type !== 'sandbox/mode') return
    const folded = state.sessionProjections.stateOf(session, 'sandboxMode') ?? null
    const currentMode = folded ?? state.sandboxPolicy.defaultMode
    if (event.data.mode === currentMode || !state.pty.hasOwnerActivity(owner)) return
    throw new Error(
      `cannot change sandbox mode from "${currentMode}" to "${event.data.mode}" while persistent terminal sessions are open or being created; wait for creation to settle and close them first`,
    )
  }, { global: true })
}

function spawnArgv(ctx: Context, config: ResolvedConfig, policy: SandboxExecutionPolicy): string[] {
  const argv = [config.shellPath, ...config.shellArgs]
  if (policy.mode === 'danger-full-access') return argv
  const sandbox = ctx.get('sandbox')
  if (sandbox === undefined) {
    throw new Error(`terminal-bash: sandbox mode "${policy.mode}" requires a ctx.sandbox provider in the execution world`)
  }
  // Re-state the discriminant because object spread does not preserve its narrowed type.
  return sandbox.confine(argv, { ...policy, mode: policy.mode }).argv
}

/** Local shell backend registered under the configured type. */
export class BashTerminalBackend implements TerminalBackend {
  readonly type: string

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly spawnTerminal: (
      spec: SubprocessTerminalSpawnSpec,
    ) => Promise<SubprocessTerminalHandle> = spec => ctx.subprocess.spawnTerminal(spec),
    private readonly createSession: (
      terminal: SubprocessTerminalHandle,
      config: ResolvedConfig,
    ) => LocalPtySession = (terminal, config) => new LocalPtySession(terminal, config),
  ) {
    this.type = config.backendType
  }

  async spawn(spec: TerminalBackendSpawnSpec): Promise<LocalPtySession> {
    spec.signal?.throwIfAborted()
    ensureSandboxModeFence(this.ctx, spec.owner)
    const policy = this.ctx.sandboxPolicy.resolve({ session: spec.owner.session })
    const argv = spawnArgv(this.ctx, this.config, policy)
    if (argv[0] === undefined) throw new Error('terminal-bash: sandbox returned empty argv')
    const terminal = await this.spawnTerminal({
      argv,
      cwd: spec.cwd ?? policy.workspaceRoot,
      env: childEnvironment({ sessionId: spec.owner.session.id, terminalId: spec.sessionId }, this.config.shellDialect),
      rows: this.config.rows,
      cols: this.config.cols,
      graceMs: this.config.disposeGraceMs,
      signal: spec.signal,
    })
    const session = this.createSession(terminal, this.config)
    try {
      await startupSession(session, this.config.shellDialect, this.config.timeoutMs, spec.signal)
      return session
    } catch (error) {
      try {
        await session.close('PTY startup failed')
      } catch (closeError: unknown) {
        throw new TerminalBackendCleanupError(error, closeError)
      }
      throw error
    }
  }
}

/** Register the local PTY backend. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  validateConfig(resolved)
  ctx.terminals.registerBackend(new BashTerminalBackend(ctx, resolved))
}
