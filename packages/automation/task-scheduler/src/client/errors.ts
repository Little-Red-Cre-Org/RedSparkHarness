/** Translate scheduler failures for the UI without exposing internal English diagnostics. */
import type { SchedulerKey } from './locales.ts'

/** Translate recognized scheduler failures and hide internal diagnostics.
 * @param message - Host failure message.
 * @param t - Localized scheduler dictionary reader.
 * @returns Localized failure text.
 */
export function schedulerError(message: string, t: (key: SchedulerKey) => string): string {
  const keys: Record<string, SchedulerKey> = {
    'Select an open session first': 'noOwners',
    'Select a normal open session': 'noOwners',
    'This conversation was deleted': 'noOwners',
    'Resumed execution would reach or exceed the schedule end time': 'resumePastEnd',
    'the schedule window has ended': 'windowEnded',
    'a finished one-shot task cannot be resumed': 'alreadyFinished',
    'Only a stopped, unfinished goal can continue': 'goalNotStopped',
    'Notification no longer exists': 'recordMissing',
    'Task not found': 'recordMissing',
    'task not found in this session': 'recordMissing',
    'Run not found': 'recordMissing',
    'Run not found in this session': 'recordMissing',
    'Running records cannot be deleted': 'cannotDeleteRunning',
    'at must be a future time with an explicit UTC offset': 'pastBeijing',
    'endAt must be later than at': 'endInvalid',
    'recurrence exceeds the supported timestamp range': 'invalidTime',
    'Goal tasks require completion criteria and cannot repeat on a timer': 'invalidGoal',
  }
  const key = keys[message]
  if (key) return t(key)
  if (/^everySeconds must be at least /u.test(message)) return t('invalidInterval')
  return /[\u3400-\u9fff]/u.test(message) ? message : t('tryAgain')
}
