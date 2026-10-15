/** Host-owned pending inbox presentation; row actions retain exact request identities. */
import { useId, useState } from 'react'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14, IconRightUpOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativePendingSubmission } from '@deepseek-ai/dsh-client-native-session/native'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './conversation.module.css'

type Translate = TranslateNS<'nativeApplication'>

function PendingRow({ item, disabled, canPromote, changePending, t }: {
  item: NativePendingSubmission
  disabled: boolean
  canPromote: boolean
  changePending: NativeConversationController['changePending']
  t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const textId = useId()
  const text = item.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
  const attachments = item.message.content.filter(part => part.type !== 'text').length
  const summary = text || t('pendingAttachments', { count: attachments })
  const expandLabel = t(expanded ? 'pendingCollapse' : 'pendingExpand')
  return <li className={css.pendingRow} data-expanded={expanded}>
    <p id={textId} className={css.pendingText}>{summary}
      {expanded && attachments > 0 && text !== '' ? <span className={css.pendingAttachmentSummary}>{t('pendingAttachments', { count: attachments })}</span> : null}
    </p>
    <div className={css.pendingActions}>
      <Button type="button" size="sm" aria-label={expandLabel} title={expandLabel}
        aria-expanded={expanded} aria-controls={textId} onClick={() => { setExpanded(value => !value) }}>
        {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
      </Button>
      <Button type="button" size="sm" aria-label={t('pendingPromote')} title={t('pendingPromote')}
        disabled={disabled || !canPromote || item.placement !== 'queued'}
        onClick={() => { void changePending(item.requestId, 'promote') }}><IconRightUpOutline16 /></Button>
      <Button type="button" size="sm" aria-label={t('pendingRemove')} title={t('pendingRemove')} disabled={disabled}
        onClick={() => { void changePending(item.requestId, 'remove') }}><IconTrashOutline16 /></Button>
    </div>
  </li>
}

export function NativePendingSubmissions({ snapshot, changePending, refresh, t }: {
  snapshot: ConversationSnapshot
  changePending: NativeConversationController['changePending']
  refresh: NativeConversationController['refreshPendingSubmissions']
  t: Translate
}) {
  if (snapshot.selected === undefined) return null
  const disabled = snapshot.submissionBusy === true || snapshot.state === 'loading' || snapshot.state === 'cancelling'
  return <section className={css.pending} aria-label={t('pendingTitle')}>
    {snapshot.submissionError === undefined ? null : <div role="alert">
      <p>{t('pendingRequestFailed')}</p>
      <Button type="button" size="sm" disabled={snapshot.submissionBusy} onClick={() => { void refresh() }}>{t('pendingRefresh')}</Button>
    </div>}
    {snapshot.submissions === undefined && snapshot.submissionError === undefined ? <p role="status">{t('pendingLoad')}</p> : null}
    {(snapshot.submissions?.submissions.length ?? 0) === 0 ? null : <ul>
      {snapshot.submissions?.submissions.map(item => <PendingRow key={item.requestId} item={item} disabled={disabled}
        canPromote={snapshot.state === 'sending'} changePending={changePending} t={t} />)}
    </ul>}
  </section>
}
