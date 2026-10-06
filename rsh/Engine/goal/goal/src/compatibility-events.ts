/** Client-safe Cordis Goal activation notifications. */
import type {} from '@deepseek-ai/cordis'
import type { GoalActivationChanged } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Process-local goal activation changed for one session.
     * @mode emit
     * @param payload - session id and the exact current goal activation, or no goal after a clear.
     */
    'goal/activation-changed'(payload: GoalActivationChanged): void
  }
}
