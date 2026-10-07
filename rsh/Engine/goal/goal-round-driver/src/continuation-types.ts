/** Explicit Goal arming through installed same-session continuation hooks. */
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { CreateGoalRequest, GoalRef, GoalView } from '@deepseek-ai/dsh-goal/types'
import type { NativeScheduledGoalAdmission, NativeScheduledGoalHost } from '@deepseek-ai/dsh-goal/native'
export type {
  NativeScheduledGoalAdmission,
  NativeScheduledGoalAdmissionAuthority,
  NativeScheduledGoalAdmissionLease,
  NativeScheduledGoalExecutor,
  NativeScheduledGoalHost,
} from '@deepseek-ai/dsh-goal/native'

/** Explicit trusted caller category; model tools never choose their own category. */
export type NativeGoalContinuationSource = 'human' | 'model'

/** Driver-owned arming; Goal remains the durable state authority. */
export interface NativeGoalContinuationOperations {
  /**
   * Create and admit the first Goal round on an exact scheduled root after verifying its durable task claim.
   * @param owner - exact attached Program root admitted with scheduled origin.
   * @param request - durable objective and round limit.
   * @param admission - scheduler-owned validation of the currently running task receipt.
   * @param signal - caller cancellation before round admission.
   * @returns durably created and armed Goal after its first Goal-source input is queued.
   */
  startScheduled(owner: NativeActiveSessionOwner, request: CreateGoalRequest,
    admission: NativeScheduledGoalAdmission, signal: AbortSignal): Promise<GoalView>
  /** Resume and enqueue one Goal-source round only under a persisted explicit task-resume claim. */
  resumeScheduled(owner: NativeActiveSessionOwner, ref: GoalRef, additionalRounds: number,
    admission: NativeScheduledGoalAdmission, signal: AbortSignal): Promise<GoalView>
  /**
   * Pause the exact Goal and drain only its active automatic turn; ordinary human turns remain active.
   * @param owner - original attached Program root owner.
   * @param ref - exact current Goal revision.
   * @returns durably paused Goal after any owned automatic turn settles.
   * @throws when the owner is no longer attached or the Goal reference is stale.
   */
  pause(owner: NativeActiveSessionOwner, ref: GoalRef, signal?: AbortSignal): Promise<GoalView>
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
    source: NativeGoalContinuationSource, signal?: AbortSignal): Promise<GoalView>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    goalContinuation: NativeGoalContinuationOperations
    scheduledGoalHost: NativeScheduledGoalHost
  }
}
