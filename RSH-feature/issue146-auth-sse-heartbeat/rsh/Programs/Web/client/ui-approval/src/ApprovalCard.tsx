/** Shared props-only approval card presentation. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './client/ApprovalPanel.module.css'

/** Render an approval request with decisions supplied by its owner.
 * @param props - request copy, detail, locale and decision callback.
 * @returns approval actions and their explanation.
 */
export function ApprovalCard({ presentationKey, toolName, reason, detail, t, disabled, onAnswer, onAllowSession }: {
  presentationKey?: string
  toolName: string
  reason?: string | undefined
  detail: ReactNode
  t: TranslateNS<'approval'>
  disabled: boolean
  onAnswer: (outcome: 'allowed-once' | 'rejected') => void
  onAllowSession?: (() => void) | undefined
}) {
  return (
    <div className={css.root} data-approval-key={presentationKey}>
      <div className={css.card}>
        <div className={css.strip}><span className={css.dot} />{t('waiting')}</div>
        <div
          className={css.body}
          data-approval-scroll=""
          tabIndex={0}
          role="group"
          aria-label={t('detail.aria')}
        >
          <div className={css.headline}>{reason ?? t('escalation', { toolName })}</div>
          {detail !== null && <div className={css.command}>{detail}</div>}
        </div>
        <div className={css.actionRow}>
          <Button variant="outline" className={css.reject} disabled={disabled} onClick={() => { onAnswer('rejected') }}>
            {t('reject')}
          </Button>
          <Button variant="primary" disabled={disabled} onClick={() => { onAnswer('allowed-once') }}>
            {t('allowOnce')}
          </Button>
          {onAllowSession === undefined ? null : <Button variant="outline" disabled={disabled} onClick={onAllowSession}>
            {t('allowSession')}
          </Button>}
        </div>
      </div>
    </div>
  )
}
