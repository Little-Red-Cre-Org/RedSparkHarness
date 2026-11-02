/** Durable Agent composition choice, shared by native and compatibility readers. */
import type {} from '@redspark/rsh-session/types'

declare module '@redspark/rsh-session/types' {
  interface SessionEventMap {
    /**
     * A blank Session selects its subsequent Agent composition.
     * @param agentPreset - selected deployment preset identifier.
     */
    'agent-preset/selected': { agentPreset: string }
  }
}
