/** Always-available sidebar entry and a persistent, actionable reminder dialog. */
import { useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { createNoticeController } from './notices.ts'
import css from './panel.module.css'
import { SchedulerPanel, type PanelInjected } from './Panel.tsx'
import { noticeStatus } from './native-notice.ts'
import { schedulerError } from './errors.ts'
import { readableBeijingTime } from '../time.ts'

type Controller = ReturnType<typeof createNoticeController>
/** Reminder operations injected into the sidebar seat. */
export interface NoticeInjected extends Omit<PanelInjected, 'hooks' | 'refresh'> {
  open: Controller['open']
  close: Controller['close']
  refresh: Controller['refresh']
  refreshTasks: PanelInjected['refresh']
  acknowledge: Controller['acknowledge']
  remove: Controller['remove']
  viewSession: (id: string) => void
  hooks: { notices: Controller['store']; snapshot: PanelInjected['hooks']['snapshot'] }
}
/** Sidebar-owned geometry plus private inbox bindings. */
export type NoticeProps = PropsRuntime<'sidebar.header.action'> & PropsLocale<'taskScheduler'> & InjectFace<NoticeInjected>
/**
 * Display unread reminders until the user explicitly acknowledges them.
 * @param props - Sidebar geometry, localized copy and observable inbox operations.
 * @returns Sidebar entry and its body-portaled reminder dialog.
 */
export function NoticePanel(props: NoticeProps): ReactNode {
  const { wide, useNotices, close, refresh, acknowledge, remove, viewSession, t } = props
  const [creating, setCreating] = useState(false)
  const state = useNotices(s => s)
  const [deleting, setDeleting] = useState<string | null>(null)
  const desktop = typeof (globalThis as { dshDesktop?: { notifyTask?: unknown } }).dshDesktop?.notifyTask === 'function'
  const [permission, setPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const enable = async (): Promise<void> => {
    try { setPermission(await Notification.requestPermission()) } catch { setPermission('denied') }
  }
  return <>
    <button className={css.reminderEntry} data-wide={wide} type="button" title={t('scheduledTask')} aria-label={t('scheduledTask')}
      onClick={() => { close(); setCreating(true) }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M12 12v5M9.5 14.5h5" />
      </svg>
      {wide && <span>{t('scheduledTask')}</span>}
    </button>
    <Modal open={creating} onClose={() => { setCreating(false) }} title={t('newTask')} closeLabel={t('cancel')}
      className={css.createDialog ?? ''} contentClassName={css.reminderContent ?? ''}>
      {creating && <SchedulerPanel {...props} refresh={props.refreshTasks} close={() => { setCreating(false) }} creationOnly />}
    </Modal>
    <Modal open={state.open && !creating} onClose={close} title={t('inbox')} closeLabel={t('closeNotices')}
      className={css.reminderDialog ?? ''} contentClassName={css.reminderContent ?? ''}>
      <div className={css.panel}>
        <p>{t('reminderHelp')}</p>
        <div className={css.actions}>
          <button type="button" onClick={() => { void refresh() }}>{t('refresh')}</button>
          {!desktop && permission === 'default' && <button type="button" onClick={() => { void enable() }}>{t('enableNotifications')}</button>}
        </div>
        {!desktop && permission === 'denied' && <p>{t('notificationsDenied')}</p>}
        {state.error && <p role="alert">{schedulerError(state.error, t)}</p>}
        {!state.items.length && <p>{t('noNotices')}</p>}
        {state.items.map(item => <article className={css.card} key={item.id}>
          <div className={css.header}><strong>{item.title}</strong><span>{t(noticeStatus(item))}</span></div>
          {item.recurring && <p>{t(item.planState === 'deleted' || (item.endAt && Date.parse(item.endAt) <= Date.now()) ? 'planEnded' : item.planState === 'paused' ? 'state.paused' : 'cycleActive')}
            {item.endAt && <> · {t('endTime')}：{readableBeijingTime(Date.parse(item.endAt))}</>}
          </p>}
          <small>{t(item.directReminder ? 'remindedAt' : item.phase === 'completed' ? 'completedAt' : item.phase === 'due' ? item.sessionId ? 'actualStart' : 'scheduledAt' : 'actualEnd')}：{readableBeijingTime(item.time)} · {t(item.read ? 'noticeRead' : 'noticeUnread')}</small>
          {item.recurring && <small>{t('retainedReminders')}：{item.occurrenceCount ?? 1}</small>}
          <p className={css.prompt}>{item.body}</p>
          <div className={css.actions}>
            <button type="button" onClick={() => { setDeleting(item.id) }}>{t('remove')}</button>
            {!item.read && <button type="button" onClick={() => { void acknowledge(item.id) }}>{t('acknowledge')}</button>}
            {item.sessionId && <button type="button" onClick={() => { if (item.sessionId) viewSession(item.sessionId); close() }}>{t('viewResult')}</button>}
          </div>
          {deleting === item.id && <div className={css.confirm}>
            <p>{t('deleteNoticeNote')}</p>
            <button type="button" onClick={() => { void remove(item.id) }}>{t('confirm')}</button>
            <button type="button" onClick={() => { setDeleting(null) }}>{t('cancel')}</button>
          </div>}
        </article>)}
      </div>
    </Modal>
  </>
}
