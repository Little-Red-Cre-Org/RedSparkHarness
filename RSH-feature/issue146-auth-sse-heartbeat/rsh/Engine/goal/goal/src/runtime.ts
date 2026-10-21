/** Runtime constructors and protocol constants for the goal domain. */

import { HarnessError } from '@deepseek-ai/dsh-llm/native'
import type { GoalErrorCode } from './facts.ts'

export { GOAL_CHANGE_VERSION, GoalId } from './replay-runtime.ts'

/** Error returned by the goal domain boundary. */
export class GoalError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: GoalErrorCode) {
    super(message, code)
  }
}
