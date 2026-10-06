/** Explicit Goal arming through installed same-session continuation hooks. */
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { CreateGoalRequest, GoalRef, GoalView } from '@deepseek-ai/dsh-goal/types'

/** Explicit trusted caller category; model tools never choose their own category. */
export type NativeGoalContinuationSource = 'human' | 'model'

/** Driver-owned arming; Goal remains the durable state authority. */
export interface NativeGoalContinuationOperations {
  /**
   * Create a Goal only while the exact owner has active continuation hooks.
   * @param owner - original attached Program root owner.
   * @param request - objective and resolved round cap.
   * @returns durably created and armed Goal.
   */
  create(owner: NativeActiveSessionOwner, request: CreateGoalRequest): Promise<GoalView>
  /**
   * Resume the same Goal, extending an exhausted round cap by an explicit allowance.
   * @param owner - original attached Program root owner.
   * @param ref - exact current Goal revision.
   * @param additionalRounds - positive allowance used only when the existing cap is exhausted.
   * @param source - explicit caller authority; a paused Goal requires a human operation.
   * @returns durably resumed and armed Goal, or its already completed state.
   */
  resume(owner: NativeActiveSessionOwner, ref: GoalRef, additionalRounds: number,
    source: NativeGoalContinuationSource): Promise<GoalView>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { goalContinuation: NativeGoalContinuationOperations }
}
