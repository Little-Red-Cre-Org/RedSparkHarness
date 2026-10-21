/** Legacy Agent backend attribution over the shared terminal protocol. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TerminalSpawnRequest, TerminalSessionIdValue, TerminalBackendSession } from './protocol.ts'
export * from './protocol.ts'

/** Fully identified request handed from the registry to a backend. */
export interface TerminalBackendSpawnSpec extends TerminalSpawnRequest {
  /** Registry-minted session identity. */
  sessionId: TerminalSessionIdValue
  /** Exact live owner for authority-aware backend setup. */
  owner: Agent
  /** Cancellation of unpublished backend setup. */
  signal?: AbortSignal
}

/** Replaceable provider for one PTY session type. */
export interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
