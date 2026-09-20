/** Occurrence timestamps distinguish direct reminder dispatch from Agent execution. */
import type { ReactNode } from 'react'
import type { SchedulerSnapshot } from '../gui-types.ts'
import { readableBeijingTime } from '../time.ts'
import type { SchedulerKey } from './locales.ts'
import css from './panel.module.css'

/** Render persisted times for this receipt at second precision.
 * @param props - Receipt and localized task-panel dictionary.
 * @returns Reminder dispatch times or Agent execution times and elapsed duration.
 */
export function RunTiming({ run, t }: { run: SchedulerSnapshot['runs'][number]; t: (key: SchedulerKey) => string }): ReactNode {
  const reminder = run.detail === 'Reminder dispatched'
  const goal = run.kind === 'goal'
  const date = readableBeijingTime
  if (reminder) return <div className={css.planTimes}>
    <span>{t('remindedAt')}<strong>{date(run.finishedAt ?? run.startedAt)}</strong></span>
  </div>
  const duration = (milliseconds: number): string => milliseconds > 0 && milliseconds < 1000
    ? t('lessThanSecond') : `${Math.round(milliseconds / 1000)} ${t('secondsUnit')}`
  const elapsed = run.finishedAt === null ? null : Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))
  return <>
    <div className={css.planTimes}>
      {!goal && <span>{t('scheduledAt')}<strong>{date(run.scheduledAt)}</strong></span>}
      <span>{t('actualStart')}<strong>{date(run.startedAt)}</strong></span>
      <span>{t(run.state === 'completed' ? 'completedAt' : 'actualEnd')}
        <strong>{run.finishedAt === null ? t('notFinished') : date(run.finishedAt)}</strong></span>
    </div>
    <>
      {elapsed !== null && <p>{t('runDuration')}：{Math.floor(elapsed / 60)} {t('minutesUnit')}{elapsed % 60 > 0 ? ` ${elapsed % 60} ${t('secondsUnit')}` : ''}</p>}
      {!goal && <p>{t('startDelay')}：{duration(run.startedAt - run.scheduledAt)}</p>}
    </>
  </>
}
