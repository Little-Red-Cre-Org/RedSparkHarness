/** Host-owned pending inbox presentation; row actions retain exact request identities. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './conversation.module.css'

export function NativePendingSubmissions({ snapshot, changePending, refresh, t }: {
  snapshot: ConversationSnapshot
  changePending: NativeConversationController['changePending']
  refresh: NativeConversationController['refreshPendingSubmissions']
  t: TranslateNS<'nativeApplication'>
}) {
  if (snapshot.selected === undefined) return null
  const disabled = snapshot.submissionBusy || snapshot.state === 'loading' || snapshot.state === 'cancelling'
  return <section className={css.pending} aria-label={t('pendingTitle')}>
    {snapshot.submissionError === undefined ? null : <div role="alert">
      <p>{t('pendingRequestFailed')}</p>
      <Button type="button" size="sm" disabled={snapshot.submissionBusy} onClick={() => { void refresh() }}>{t('pendingRefresh')}</Button>
    </div>}
    {snapshot.submissions === undefined && snapshot.submissionError === undefined ? <p role="status">{t('pendingLoad')}</p> : null}
    {(snapshot.submissions?.submissions.length ?? 0) === 0 ? null : <>
      <h2>{t('pendingTitle')}</h2>
      <ul>{snapshot.submissions?.submissions.map((item) => {
        const text = item.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
        const attachments = item.message.content.filter(part => part.type !== 'text').length
        return <li key={item.requestId}>
          <span>{t(item.placement === 'queued' ? 'pendingQueued' : 'pendingSteering')}</span>
          <p className={css.pendingText}>{text}</p>
          {attachments === 0 ? null : <p>{t('pendingAttachments', { count: attachments })}</p>}
          <div>
            {item.placement !== 'queued' ? null : <Button type="button" size="sm" disabled={disabled || snapshot.state !== 'sending'}
              onClick={() => { void changePending(item.requestId, 'promote') }}>{t('pendingPromote')}</Button>}
            <Button type="button" size="sm" disabled={disabled}
              onClick={() => { void changePending(item.requestId, 'remove') }}>{t('pendingRemove')}</Button>
          </div>
        </li>
      })}</ul>
    </>}
  </section>
}
