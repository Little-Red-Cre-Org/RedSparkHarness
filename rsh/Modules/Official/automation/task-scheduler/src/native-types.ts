/** Native management of persisted scheduled work and personal reminders in one selected Program route. */
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeScheduledGoalHost } from '@deepseek-ai/dsh-goal/native'
import type { CreateTaskRequest } from './gui-types.ts'
import type { Run, Task, TaskId } from './types.ts'

/** Owner-scoped durable management; management never sends a model request. */
export interface NativeTaskSchedulerOperations {
  /**
   * Capture the current Program route and save future Agent work, Goal work, or a personal reminder.
   * @param owner - exact attached interactive root owner.
   * @param request - explicit task timing and instructions; Goal mode requires the Goal Provider and driver.
   * @param signal - caller cancellation before durable admission.
   * @returns the saved plan without starting execution.
   */
  create(owner: NativeActiveSessionOwner, request: CreateTaskRequest, signal: AbortSignal): Task
  /**
   * Read nondeleted plans owned by this exact Session.
   * @param owner - exact attached interactive root owner.
   * @returns persisted owned plans.
   */
  list(owner: NativeActiveSessionOwner): readonly Task[]
  /**
   * Change future admission; pausing a Goal also pauses its exact live continuation.
   * @param owner - exact attached interactive root owner.
   * @param id - exact saved plan identity.
   * @param state - future admission state.
   * @param signal - cancellation before durable mutation.
   * @returns the updated persisted plan.
   */
  change(owner: NativeActiveSessionOwner, id: TaskId, state: Task['state'], signal: AbortSignal): Promise<Task>
  /**
   * Read retained receipts, including deleted owned plans.
   * @param owner - exact attached interactive root owner.
   * @param id - optional owned plan filter.
   * @returns newest owned receipts up to the configured history limit.
   */
  history(owner: NativeActiveSessionOwner, id?: TaskId): readonly Run[]
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    taskScheduler: NativeTaskSchedulerOperations
    scheduledGoalHost: NativeScheduledGoalHost
  }
}
