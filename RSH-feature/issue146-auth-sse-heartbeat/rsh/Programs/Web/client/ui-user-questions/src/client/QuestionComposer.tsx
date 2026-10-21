/** Compatibility Slot adapter for the shared question presentations. */
import { useMemo } from 'react'
import type { QuestionComposerProps } from './contract/slots.ts'
import { planReviewOf } from '../question-presentation.ts'
import type { QuestionPresentation } from '../question-presentation.ts'
import { QuestionFlow, parseRecommendedLabel } from '../QuestionFlow.tsx'
import { PlanReviewPanel } from './PlanReviewPanel.tsx'
import type { QuestionDraftProgress } from './draft-store.ts'

export { parseRecommendedLabel }

/**
 * Composer takeover router. Generic-question drafts live in this entry's
 * Session-scoped Slot store, keyed by the pending carrier, so a strict Session
 * entry remount restores the same request without exposing it to another one.
 *
 * One takeover, two presentations: a request that declares a presentation intent this
 * package renders uses that presentation (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither presentation can claim a request the other is already rendering.
 *
 * @param props - the selector-matched pending question carrier plus the framework standard kit.
 * @returns The question flow, or the intent's own surface, for this request.
 */
export function QuestionComposer(props: QuestionComposerProps) {
  const question = props.matched
  const review = useMemo(() => planReviewOf(question.questions), [question])
  const initialProgress = useMemo<QuestionDraftProgress>(() => ({
    index: 0,
    drafts: question.questions.map(() => ({ selected: [], custom: '', skipped: false })),
  }), [question.questions])
  const storedProgress = props.useStore(state => (
    state.requestKey === question.key && state.progress.drafts.length === question.questions.length
      ? state.progress
      : undefined
  ))
  const pending: QuestionPresentation = {
    key: question.key,
    questions: question.questions,
    answer: answer => question.answer(answer),
    cancel: () => question.cancel(),
  }
  return review === undefined
    ? (
      <QuestionFlow
        key={question.key}
        pending={pending}
        t={props.t}
        progress={storedProgress ?? initialProgress}
        onProgress={(progress) => { props.actions.replace(question.key, progress) }}
        onClear={() => { props.actions.clear(question.key) }}
      />
    )
    : <PlanReviewPanel key={question.key} pending={pending} review={review} t={props.t} />
}
