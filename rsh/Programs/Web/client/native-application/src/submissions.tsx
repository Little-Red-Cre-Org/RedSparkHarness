/** Host-owned pending inbox presentation; row actions retain exact request identities. */
import { useEffect, useId, useState } from 'react'
import { Button, IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, IconRightUpOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativePendingSubmission, NativeSubmissionRequestId } from '@deepseek-ai/dsh-client-native-session/native'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './conversation.module.css'

type Translate = TranslateNS<'nativeApplication'>

interface PendingEdit {
  draft: string
  failed: boolean
}

function PendingRow({ requestId, item, edit, setEdit, save, disabled, canPromote, changePending, t }: {
  requestId: NativeSubmissionRequestId
  item: NativePendingSubmission | undefined
  edit: PendingEdit | undefined
  setEdit: (edit: PendingEdit | undefined) => void
  save: () => Promise<void>
  disabled: boolean
  canPromote: boolean
  changePending: NativeConversationController['changePending']
  t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const editing = edit !== undefined
  const absent = item === undefined
  const textId = useId()
  const text = item?.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') ?? ''
  const attachments = item?.message.content.filter(part => part.type !== 'text').length ?? 0
  const summary = text || t('pendingAttachments', { count: attachments })
  const isExpanded = expanded || editing
  const expandLabel = t(isExpanded ? 'pendingCollapse' : 'pendingExpand')
  return <li className={css.pendingRow} data-expanded={isExpanded}>
    {item === undefined ? null : <span className={css.pendingTag} data-placement={item.placement}>
      {t(item.placement === 'queued' ? 'pendingQueuedTag' : 'pendingSteeringTag')}
    </span>}
    {editing
      ? <div className={css.pendingEditorWrap}>
        <textarea id={textId} className={css.pendingEditor} aria-label={t('pendingEdit')} rows={2}
          value={edit.draft} disabled={disabled} onChange={(event) => { setEdit({ draft: event.target.value, failed: false }) }} />
        {absent ? <span role="status">{t('pendingEditAbsent', { requestId })}</span>
          : edit.failed ? <span role="status">{t('pendingEditFailed')}</span> : null}
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
          disabled={disabled || absent || edit.draft.trim() === ''} onClick={() => { void save() }}><IconCheckOutline16 /></Button>
        <Button type="button" size="sm" aria-label={t('pendingEditCancel')} title={t('pendingEditCancel')}
          disabled={disabled} onClick={() => { setEdit(undefined) }}><IconCloseOutline16 /></Button>
      </> : <Button type="button" size="sm" aria-label={t('pendingEdit')} title={t('pendingEdit')}
        disabled={disabled || attachments > 0} onClick={() => { setEdit({ draft: text, failed: false }) }}>
        <IconEditOutline16 />
      </Button>}
      <Button type="button" size="sm" aria-label={t('pendingPromote')} title={t('pendingPromote')}
        disabled={disabled || editing || !canPromote || item?.placement !== 'queued'}
        onClick={() => { void changePending(requestId, 'promote') }}><IconRightUpOutline16 /></Button>
      <Button type="button" size="sm" aria-label={t('pendingRemove')} title={t('pendingRemove')} disabled={disabled || editing}
        onClick={() => { void changePending(requestId, 'remove') }}><IconTrashOutline16 /></Button>
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
  const [edits, setEdits] = useState(new Map<NativeSubmissionRequestId, PendingEdit>())
  useEffect(() => { setEdits(new Map()) }, [snapshot.selected])
  const setEdit = (requestId: NativeSubmissionRequestId, edit: PendingEdit | undefined): void => {
    setEdits((current) => {
      const next = new Map(current)
      if (edit === undefined) next.delete(requestId)
      else next.set(requestId, edit)
      return next
    })
  }
  const save = async (requestId: NativeSubmissionRequestId, edit: PendingEdit): Promise<void> => {
    const saved = await editPending(requestId, edit.draft)
    setEdits((current) => {
      // An edit completion must not restore a dismissed draft or one from another Session.
      if (current.get(requestId) !== edit) return current
      const next = new Map(current)
      if (saved) next.delete(requestId)
      else next.set(requestId, { ...edit, failed: true })
      return next
    })
  }
  if (snapshot.selected === undefined) return null
  const items = new Map(snapshot.submissions?.submissions.map(item => [item.requestId, item]))
  const requestIds = new Set([...items.keys(), ...edits.keys()])
  const disabled = snapshot.submissionBusy === true || snapshot.state === 'loading' || snapshot.state === 'closed'
    || snapshot.state === 'cancelling' || snapshot.navigationPending === true
  return <section className={css.pending} aria-label={t('pendingTitle')}>
    {snapshot.submissionError === undefined ? null : <div role="alert">
      <p>{t('pendingRequestFailed')}</p>
      <Button type="button" size="sm" disabled={snapshot.submissionBusy} onClick={() => { void refresh() }}>{t('pendingRefresh')}</Button>
    </div>}
    {snapshot.submissions === undefined && snapshot.submissionError === undefined ? <p role="status">{t('pendingLoad')}</p> : null}
    {requestIds.size === 0 ? null : <ul>
      {[...requestIds].map((requestId) => {
        const edit = edits.get(requestId)
        return <PendingRow key={requestId} requestId={requestId} item={items.get(requestId)} edit={edit}
          setEdit={(value) => { setEdit(requestId, value) }} save={async () => { if (edit !== undefined) await save(requestId, edit) }}
          disabled={disabled} canPromote={snapshot.state === 'sending'} changePending={changePending} t={t} />
      })}
    </ul>}
  </section>
}
