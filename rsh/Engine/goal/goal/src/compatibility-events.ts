/** Client-safe Cordis Goal activation notifications. */
import type {} from '@redspark/cordis'
import type { GoalActivationChanged } from './types.ts'

declare module '@redspark/cordis' {
  interface Events {
    /**
     * Process-local goal activation changed for one session.
     * @mode emit
     * @param payload - session id and the exact current goal activation, or no goal after a clear.
     */
    'goal/activation-changed'(payload: GoalActivationChanged): void
  }
}
