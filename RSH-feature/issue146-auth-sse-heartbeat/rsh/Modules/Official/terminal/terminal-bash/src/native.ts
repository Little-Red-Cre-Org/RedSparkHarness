/** Native local PTY backend for terminal allocation and awaited teardown. */
import { isAbsolute } from 'node:path'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-terminal/native'
import type { NativeTerminalBackend, NativeTerminalSession } from '@deepseek-ai/dsh-terminal/native'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-sandbox/native'

import { Config, resolveConfig, validateConfig, type ResolvedConfig } from './config.ts'
import { LocalPtySession } from './session.ts'
import { childEnvironment, startupSession } from './startup.ts'
import { TerminalBackendCleanupError } from '@deepseek-ai/dsh-terminal/protocol'

/** Resolve the shared shell, startup and output budgets for a native installation.
 * @param input - native profile configuration; type and graceMs retain their lifecycle spellings.
 * @returns validated configuration used by the existing PTY implementation.
 */
export function resolveNativeConfig(input: unknown): ResolvedConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('terminal-bash: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['type', 'shellPath', 'shellArgs', 'rows', 'cols', 'graceMs', 'shellDialect', 'scrollbackLines',
      'scrollbackMaxBytes', 'maxReadBytes', 'pollIntervalMs', 'exactProbeAfterMs', 'idleSilenceMs',
      'handoffGraceMs', 'timeoutMs'].includes(key)) throw new Error(`terminal-bash: unsupported configuration field ${key}`)
  }
  if (typeof fields.type !== 'string' || fields.type.trim().length === 0) throw new Error('terminal-bash: type must be nonempty')
  const { type, graceMs, ...options } = fields
  const config = resolveConfig(Config({ ...options, backendType: type,
    ...graceMs === undefined ? {} : { disposeGraceMs: graceMs } } as Config))
  validateConfig(config)
  return config
}

/** Register the existing interactive shell implementation over native selected Providers. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-terminal-bash', targets: ['host'],
  requires: ['terminals', 'subprocess', 'sandboxPolicy'], optional: ['sandbox'], provides: [],
  resolve(input) {
    const config = resolveNativeConfig(input)
    return (context) => {
      const terminals = context.require('terminals')
      const subprocess = context.require('subprocess')
      const policy = context.require('sandboxPolicy')
      const sandbox = context.optional('sandbox')
      if (policy.defaultMode !== 'danger-full-access' && sandbox === undefined) {
        throw new Error('terminal-bash: confined PTY requires a sandbox Provider')
      }
      const backend: NativeTerminalBackend = {
        type: config.backendType,
        async spawn(spec): Promise<NativeTerminalSession> {
          const selected = policy.resolve({ session: spec.session })
          const executable = await subprocess.resolveExecutable(config.shellPath, undefined, spec.signal)
          const argv = [executable, ...config.shellArgs]
          const confined = selected.mode === 'danger-full-access'
            ? argv
            : sandbox?.confine(argv, { ...selected, mode: selected.mode }).argv
          if (confined === undefined || confined.length === 0) throw new Error('terminal-bash: sandbox returned empty argv')
          const cwd = spec.cwd ?? selected.workspaceRoot
          if (!isAbsolute(cwd)) throw new Error('terminal-bash: cwd must be absolute')
          const terminal = await subprocess.spawnTerminal({
            argv: confined, cwd, rows: config.rows, cols: config.cols, graceMs: config.disposeGraceMs, signal: spec.signal,
            env: childEnvironment({ sessionId: spec.session.id, terminalId: spec.sessionId }, config.shellDialect),
          })
          const session = new LocalPtySession(terminal, config)
          try {
            await startupSession(session, config.shellDialect, config.timeoutMs, spec.signal)
          } catch (error) {
            try { await session.close('PTY startup failed') }
            catch (cleanup: unknown) { throw new TerminalBackendCleanupError(error, cleanup) }
            throw error
          }
          return {
            get pid() { return session.pid }, interaction: session,
            status: () => session.status().kind === 'running' ? 'running' : 'exited',
            close: () => session.close('native terminal closed'),
          }
        },
      }
      context.effect(terminals.registerBackend(backend))
    }
  },
}
