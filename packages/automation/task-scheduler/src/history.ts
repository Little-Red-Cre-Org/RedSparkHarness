/** History timing uses retained task definitions, including deleted plans. */
import type { Run, Task } from './types.ts'

/** Resolve this occurrence's waiting period independently of the visible task list.
 * @param run - Persisted occurrence.
 * @param task - Retained task definition, including a deletion tombstone.
 * @returns Countdown start, preceding recurring boundary, execution start without a countdown, or null if the definition is missing.
 */
export function reminderStartTime(run: Run, task: Task | undefined): number | null {
  if (!task) return null
  if (task.everySeconds !== undefined && run.scheduledAt > Date.parse(task.at)) {
    return run.scheduledAt - task.everySeconds * 1000
  }
  return task.countdownStartedAt === undefined ? run.startedAt : Date.parse(task.countdownStartedAt)
}
