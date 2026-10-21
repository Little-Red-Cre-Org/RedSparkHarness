/** Localized content for Windows/browser system notification banners. */
import type { TaskNotice } from '../gui-types.ts'
import type { SchedulerKey } from './locales.ts'

/**
 * Format a task's real outcome without presenting failures as completed work.
 * @param item - Committed task reminder or outcome.
 * @param t - The task plugin's localized dictionary reader.
 * @returns System banner title and body, including task name and outcome.
 */
export function nativeNoticeContent(item: TaskNotice, t: (key: SchedulerKey) => string): { title: string; body: string } {
  const status = t(noticeStatus(item))
  return { title: `${item.title} · ${status}`,
    body: `${t('nativeTask')}${item.title}\n${t('nativeStatus')}${status}\n${item.phase === 'due' || item.directReminder ? item.body.slice(0, 160) : t('nativeOpenResult')}` }
}

/** A due plan waits until its execution session is attached.
 * @param item - Persisted reminder or execution outcome.
 * @returns Localized status key.
 */
export function noticeStatus(item: TaskNotice): SchedulerKey {
  if (item.directReminder) return 'reminderSent'
  if (item.phase === 'due') return item.sessionId ? 'state.running' : 'waitingExecution'
  if (item.phase === 'completed') return item.recurring ? 'occurrenceCompleted' : 'nativeCompleted'
  return `state.${item.phase}`
}
