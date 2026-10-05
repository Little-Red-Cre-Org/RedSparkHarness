/** Complete-history Agent composition facts without activation or mounting. */
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
export type * from './selection-events.ts'

/** Selected creation or blank-window composition and its last explicit revision. */
export interface NativeAgentPresetFacts {
  readonly preset: string | null
  readonly revision: SessionSeq | null
  readonly locked: boolean
}

/**
 * Reconstruct composition choice from creation facts and every inherited event.
 * @param header - immutable Session creation preset, when present.
 * @param events - complete validated chronological history, including fork prefix.
 * @returns selected identifier, last selection revision and first-turn lock.
 */
export function foldNativeAgentPresetFacts(header: { readonly agentPreset?: string },
  events: readonly SessionEvent[]): NativeAgentPresetFacts {
  let state: NativeAgentPresetFacts = { preset: header.agentPreset ?? null, revision: null, locked: false }
  for (const event of events) {
    switch (event.type) {
      case 'agent-preset/selected': state = { ...state, preset: event.data.agentPreset, revision: event.seq }; break
      case 'turn/start': state = { ...state, locked: true }; break
      default: break // Other merge-extensible events do not select a composition or start a turn.
    }
  }
  return state
}

/** Human choice for an existing blank Session; the Program owns compare-and-set and epoch replacement. */
export interface NativeAgentPresetSelectionRequest {
  readonly id: SessionId
  readonly preset: string
  readonly expectedRevision: SessionSeq | null
}
