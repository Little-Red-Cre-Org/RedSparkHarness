/** Cordis-free command execution definition shared by native shell Providers. */
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox/native'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from './types.ts'
import type {} from '@deepseek-ai/dsh-native-runtime'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { shell: ShellOperations }
}

/** Settings namespace shared by shell executor implementations. */
export const SHELL_SETTINGS_NAMESPACE = 'shell'

export { DSH_ENV_PREFIX } from './types.ts'
export type {
  ShellExecRequest, ShellExecSpec, ShellProcess, ShellProcessRead,
  ShellProcessStatus, ShellRunResult, ShellSandboxInfo,
  CollectedOutput, DshEnvironment, DshEnvironmentKey,
} from './types.ts'
export { parseExitStatus } from './render.ts'
export { canonicalShellResult } from './result.ts'
export type { ParsedExitStatus } from './render.ts'

/** Resolved foreground and background shell operations. */
export interface ShellOperations {
  /** Configured default mode, absent for an executor without confinement. */
  readonly sandboxMode: SandboxMode | undefined
  /** Apply configured defaults and caps before any command runs. */
  resolve(request: ShellExecRequest): ShellExecSpec
  /** Run a resolved command; nonzero exits, timeout, and abort resolve as results. */
  run(spec: ShellExecSpec): Promise<ShellRunResult>
  /** Start a resolved command without an executor timeout. */
  start(spec: ShellExecSpec): ShellProcess
}
