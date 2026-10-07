/** Stable transcript record shared by compatibility and Native delivery. */
import type { Task, Run } from './types.ts'
import { readableBeijingTime } from './time.ts'

/**
 * Format one durable personal reminder record without selecting a Session owner.
 * @param task - Persisted reminder plan.
 * @param run - Claimed or settled occurrence.
 * @returns Deterministic message identity and the existing transcript presentation.
 */
export function formatReminderRecord(task: Task, run: Run): { id: string; summary: string; text: string } {
  const id = `reminder-${run.id}`
  const when = readableBeijingTime(run.finishedAt ?? run.startedAt)
  const status = run.state === 'completed' ? '已提醒' : '未完成'
  const summary = `${when} · ${task.title} · ${status}`.slice(0, 120)
  return { id, summary, text: `${summary}\n${task.prompt}\n计划时间：${readableBeijingTime(run.scheduledAt)}\n实际时间：${when}` }
}
