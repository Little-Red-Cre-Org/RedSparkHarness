/** Durable Agent composition choice, shared by native and compatibility readers. */
import type {} from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A blank Session selects its subsequent Agent composition.
     * @param agentPreset - selected deployment preset identifier.
     */
    'agent-preset/selected': { agentPreset: string }
  }
}
