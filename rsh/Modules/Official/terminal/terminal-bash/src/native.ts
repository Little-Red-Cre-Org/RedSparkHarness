/** Native local PTY backend for terminal allocation and awaited teardown. */
import { isAbsolute } from 'node:path'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-terminal/native'
import type { NativeTerminalBackend, NativeTerminalSession } from '@deepseek-ai/dsh-terminal/native'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-sandbox/native'

interface Config {
  readonly type: string
  readonly shellPath: string
  readonly shellArgs: readonly string[]
  readonly rows: number
  readonly cols: number
  readonly graceMs: number
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`terminal-bash: ${field} must be a positive safe integer`)
  }
  return value
}

/** Validate explicit PTY command and sizing before installation.
 * @param input - untrusted native profile configuration.
 * @returns exact shell command and terminal allocation budgets.
 */
export function resolveNativeConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('terminal-bash: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['type', 'shellPath', 'shellArgs', 'rows', 'cols', 'graceMs'].includes(key)) {
      throw new Error(`terminal-bash: unsupported configuration field ${key}`)
    }
  }
  if (typeof fields.type !== 'string' || fields.type.trim().length === 0) throw new Error('terminal-bash: type must be nonempty')
  if (typeof fields.shellPath !== 'string' || fields.shellPath.trim().length === 0) {
    throw new Error('terminal-bash: shellPath must be a nonempty executable')
  }
  if (!Array.isArray(fields.shellArgs) || fields.shellArgs.some(value => typeof value !== 'string')) {
    throw new Error('terminal-bash: shellArgs must be an array of strings')
  }
  return {
    type: fields.type, shellPath: fields.shellPath, shellArgs: fields.shellArgs as string[],
    rows: positiveInteger(fields.rows, 'rows'), cols: positiveInteger(fields.cols, 'cols'),
    graceMs: positiveInteger(fields.graceMs, 'graceMs'),
  }
}

/** Register a real PTY process backend without exposing interactive I/O yet. */
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
        type: config.type,
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
            argv: confined, cwd, rows: config.rows, cols: config.cols, graceMs: config.graceMs, signal: spec.signal,
          })
          let state: 'running' | 'exited' | 'failed' = 'running'
          terminal.output.resume()
          void terminal.done.then(
            () => { state = 'exited' },
            () => { state = 'failed' },
          )
          return { get pid() { return terminal.pid }, status: () => state, close: () => terminal.terminate() }
        },
      }
      context.effect(terminals.registerBackend(backend))
    }
  },
}
