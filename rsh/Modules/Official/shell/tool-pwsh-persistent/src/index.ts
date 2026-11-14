/* jscpd:ignore-start */
// Deliberate mirror of tool-bash-persistent (persistent-pty note 2026-08-11-pwsh-persistent-pty):
// the PowerShell counterpart shares the session registry, polling loop, and reset contract by design.
/**
 * Cordis adapter for the owner-scoped persistent `pwsh` tool.
 * @module @redspark/rsh-tool-pwsh-persistent
 */

import type { Context } from '@redspark/cordis'
import z from '@redspark/schemastery'
import type { Agent } from '@redspark/rsh-agent'
import type { TerminalSessionId } from '@redspark/rsh-terminal'
import { defineTool } from '@redspark/rsh-tools'
import {
  DEFAULT_DESCRIPTION,
  createPersistentPwshRuntime,
  resolvePersistentPwshConfig,
  type PersistentTerminalPorts,
} from './persistent-core.ts'

export const name = 'tool-pwsh-persistent'
export const inject = ['tools', 'terminals']

/** Configuration for the persistent pwsh tool. */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  description?: string
}

/** Runtime configuration schema for the persistent pwsh tool. */
export const Config: z<Config> = z.object({
  backendType: z.string().default('shell'),
  timeoutMs: z.number().default(300_000),
  maxOutputChars: z.number().default(16_000),
  description: z.string().default(DEFAULT_DESCRIPTION),
})

function register(ctx: Context, config: ReturnType<typeof resolvePersistentPwshConfig>): void {
  const runtime = createPersistentPwshRuntime<Agent, TerminalSessionId>(ports(ctx), config)
  ctx.tools.register(defineTool({
    name: 'pwsh',
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The PowerShell command to run. Relative path is preferred in the command.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (args.command.trim().length === 0) throw new Error('command must be a non-empty string')
      const owner = exec.agent
      if (owner === undefined) throw new Error('pwsh requires an owning agent session')
      return runtime.execute(owner, args.command, exec.signal, async (signal) => {
        const cwd = owner.session.header.cwd
        const spawned = await ctx.terminals.spawn(owner, {
          type: config.backendType,
          ...cwd === undefined ? {} : { cwd },
        }, signal)
        return spawned.sessionId
      })
    },
    presentCall: args => ({ card: 'terminal', title: args.command }),
  }))
}

function ports(ctx: Context): PersistentTerminalPorts<Agent, TerminalSessionId> {
  return {
    status(owner, id) {
      const status = ctx.terminals.list(owner).find(session => session.sessionId === id)?.status
      if (status === undefined) return undefined
      if (status.kind === 'running') return { kind: 'running', exitCode: null, signal: null }
      return { kind: 'exited', exitCode: status.exitCode, signal: status.signal }
    },
    async close(owner, id, reason) {
      if (!ctx.terminals.list(owner).some(session => session.sessionId === id)) return
      await ctx.terminals.kill(owner, id, reason)
    },
    startSend: (owner, id, request) => ctx.terminals.startSend(owner, id, request),
    read: (owner, id, request) => ctx.terminals.read(owner, id, request),
    onDispose(cleanup) {
      ctx.effect(() => cleanup, 'tool-pwsh-persistent shell cleanup')
    },
    onOwnerDispose(owner, cleanup) {
      owner.ctx.effect(() => cleanup, 'tool-pwsh-persistent owner cache cleanup')
    },
  }
}

/**
 * Register one owner-scoped persistent `pwsh` tool.
 * @param ctx - Cordis context providing tools and terminals.
 * @param config - selected backend, deadline, output bound and description.
 */
export function apply(ctx: Context, config: Config): void {
  register(ctx, resolvePersistentPwshConfig(config, name))
}
/* jscpd:ignore-end */
