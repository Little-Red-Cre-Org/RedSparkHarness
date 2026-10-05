/** Installed composition metadata and durable blank-Session selection for the terminal. */
import type { NativeAgentPresetFacts, NativeAgentPresetSelectionRequest } from '@deepseek-ai/dsh-agent-presets/selection'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Detached standing metadata; scopes and Agent leases remain on the Host. */
export interface TerminalPresetState {
  readonly facts: NativeAgentPresetFacts
  readonly entries: readonly { readonly id: string; readonly name: string; readonly description?: string }[]
}

/** Existing persistence and root-selection operations without renderer-owned execution. */
export interface TerminalPresetOperations {
  /** @param id - selected Session. @param signal - menu cancellation. @returns complete durable facts and installed choices. */
  read(id: SessionId, signal: AbortSignal): Promise<TerminalPresetState>
  /**
   * @param id - selected blank Session.
   * @param request - installed composition and observed durable revision.
   * @param signal - selection cancellation.
   * @returns committed composition facts and current installed choices.
   */
  select(id: SessionId, request: Omit<NativeAgentPresetSelectionRequest, 'id'>, signal: AbortSignal): Promise<TerminalPresetState>
}
