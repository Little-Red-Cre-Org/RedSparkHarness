/** Host-owned pending inbox presentation; row actions retain exact request identities. */
import { useId, useState } from 'react'
import { Button, IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, IconRightUpOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativePendingSubmission } from '@deepseek-ai/dsh-client-native-session/native'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './conversation.module.css'

type Translate = TranslateNS<'nativeApplication'>

function PendingRow({ item, disabled, canPromote, changePending, editPending, t }: {
  item: NativePendingSubmission
  disabled: boolean
  canPromote: boolean
  changePending: NativeConversationController['changePending']
  editPending: NativeConversationController['editPending']
  t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editFailed, setEditFailed] = useState(false)
  const textId = useId()
  const text = item.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
  const attachments = item.message.content.filter(part => part.type !== 'text').length
  const summary = text || t('pendingAttachments', { count: attachments })
  const isExpanded = expanded || editing
  const expandLabel = t(isExpanded ? 'pendingCollapse' : 'pendingExpand')
  const save = async (): Promise<void> => {
    setEditFailed(false)
    if (await editPending(item.requestId, draft)) setEditing(false)
    else setEditFailed(true)
  }
  return <li className={css.pendingRow} data-expanded={isExpanded}>
    {editing
      ? <div className={css.pendingEditorWrap}>
        <textarea id={textId} className={css.pendingEditor} aria-label={t('pendingEdit')} rows={2}
          value={draft} disabled={disabled} onChange={(event) => { setDraft(event.target.value); setEditFailed(false) }} />
        {editFailed ? <span role="status">{t('pendingEditFailed')}</span> : null}
      </div>
      : <p id={textId} className={css.pendingText}>{summary}
        {expanded && attachments > 0 && text !== '' ? <span className={css.pendingAttachmentSummary}>{t('pendingAttachments', { count: attachments })}</span> : null}
      </p>}
    <div className={css.pendingActions}>
      <Button type="button" size="sm" aria-label={expandLabel} title={expandLabel}
        aria-expanded={isExpanded} aria-controls={textId} disabled={disabled || editing}
        onClick={() => { setExpanded(value => !value) }}>
        {isExpanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
      </Button>
      {editing ? <>
        <Button type="button" size="sm" aria-label={t('pendingEditSave')} title={t('pendingEditSave')}
          disabled={disabled || draft.trim() === ''} onClick={() => { void save() }}><IconCheckOutline16 /></Button>
        <Button type="button" size="sm" aria-label={t('pendingEditCancel')} title={t('pendingEditCancel')}
          disabled={disabled} onClick={() => { setEditing(false); setEditFailed(false) }}><IconCloseOutline16 /></Button>
      </> : <Button type="button" size="sm" aria-label={t('pendingEdit')} title={t('pendingEdit')}
        disabled={disabled || attachments > 0} onClick={() => { setDraft(text); setEditFailed(false); setEditing(true) }}>
        <IconEditOutline16 />
      </Button>}
      <Button type="button" size="sm" aria-label={t('pendingPromote')} title={t('pendingPromote')}
        disabled={disabled || editing || !canPromote || item.placement !== 'queued'}
        onClick={() => { void changePending(item.requestId, 'promote') }}><IconRightUpOutline16 /></Button>
      <Button type="button" size="sm" aria-label={t('pendingRemove')} title={t('pendingRemove')} disabled={disabled || editing}
        onClick={() => { void changePending(item.requestId, 'remove') }}><IconTrashOutline16 /></Button>
    </div>
  </li>
}

export function NativePendingSubmissions({ snapshot, changePending, editPending, refresh, t }: {
  snapshot: ConversationSnapshot
  changePending: NativeConversationController['changePending']
  editPending: NativeConversationController['editPending']
  refresh: NativeConversationController['refreshPendingSubmissions']
  t: Translate
}) {
  if (snapshot.selected === undefined) return null
  const disabled = snapshot.submissionBusy === true || snapshot.state === 'loading' || snapshot.state === 'closed'
    || snapshot.state === 'cancelling'
  return <section className={css.pending} aria-label={t('pendingTitle')}>
    {snapshot.submissionError === undefined ? null : <div role="alert">
      <p>{t('pendingRequestFailed')}</p>
      <Button type="button" size="sm" disabled={snapshot.submissionBusy} onClick={() => { void refresh() }}>{t('pendingRefresh')}</Button>
    </div>}
    {snapshot.submissions === undefined && snapshot.submissionError === undefined ? <p role="status">{t('pendingLoad')}</p> : null}
    {(snapshot.submissions?.submissions.length ?? 0) === 0 ? null : <ul>
      {snapshot.submissions?.submissions.map(item => <PendingRow key={item.requestId} item={item} disabled={disabled}
        canPromote={snapshot.state === 'sending'} changePending={changePending} editPending={editPending} t={t} />)}
    </ul>}
  </section>
}
