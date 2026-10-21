/** A cycle stays active until its deadline, including the wait after its last occurrence. */
import type { Task } from '../types.ts'

/** Determine whether the schedule has ended.
 * @param task - Saved schedule state.
 * @param now - Current Unix time in milliseconds.
 * @returns Whether no further execution is possible.
 */
export function scheduleEnded(task: Pick<Task, 'state' | 'everySeconds' | 'endAt' | 'nextAt'>, now: number): boolean {
  if (task.state === 'deleted') return true
  if (task.endAt !== undefined && Date.parse(task.endAt) <= now) return true
  return task.everySeconds === undefined && task.nextAt === null
}
