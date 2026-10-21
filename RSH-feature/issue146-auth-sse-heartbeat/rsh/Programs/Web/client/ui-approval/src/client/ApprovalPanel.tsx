/** Composer takeover for one pending approval waterfall. */
import { useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ApprovalComposerProps, PendingApproval } from './contract/slots.ts'
import { ApprovalCard } from '../ApprovalCard.tsx'

/**
 * Render one pending approval and its optional Tool-owned detail.
 * @param props - selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const detail = approval.callId === undefined
    ? null
    : props.renderSlot('conversation.approval.detail', { callId: approval.callId })
  return <ApprovalFlow key={approval.key} pending={approval} detail={detail} t={props.t} />
}

function ApprovalFlow({ pending, detail, t }: {
  pending: PendingApproval
  detail: ReactNode
  t: TranslateNS<'approval'>
}) {
  const [answered, setAnswered] = useState(false)
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    setAnswered(true)
    void pending.answer(outcome).catch(() => { setAnswered(false) })
  }
  return (
    <ApprovalCard presentationKey={pending.key} toolName={pending.toolName} reason={pending.reason}
      detail={detail} t={t} disabled={answered} onAnswer={answer} />
  )
}
