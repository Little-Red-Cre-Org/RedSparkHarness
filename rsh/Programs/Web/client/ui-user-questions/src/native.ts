/** Cordis-free question cards for Native Client consumers. */
import { createElement, useMemo, useState, type ReactElement } from 'react'
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@deepseek-ai/dsh-client-locale/dictionary'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { QuestionFlow } from './QuestionFlow.tsx'
import { PlanReviewPanel } from './client/PlanReviewPanel.tsx'
import { en, zh } from './client/locales.ts'
import { planReviewOf } from './question-presentation.ts'
import type {
  QuestionAnswer, QuestionDraftProgress, QuestionItem, QuestionPresentation,
} from './question-presentation.ts'

/** Props for the shared Native question and plan-review presentations. */
export interface NativeQuestionComposerProps {
  /** Stable identity of this pending question request. */
  readonly requestKey: string
  /** Questions and optional plan-review intent from the Host. */
  readonly questions: readonly QuestionItem[]
  /** Native locale. */
  readonly locale: 'en' | 'zh'
  /** Disable answer controls while the Host acknowledges a submission. */
  readonly disabled: boolean
  /** Submit the complete structured answer batch. */
  readonly onAnswer: (answer: QuestionAnswer) => Promise<void>
  /** Cancel the entire pending question batch without cancelling the turn. */
  readonly onCancel?: (() => Promise<void>) | undefined
}

/** Render the legacy question composer with Native answer actions.
 * @param props - pending question batch, locale and Host answer callback.
 * @returns generic question flow or supported plan-review card.
 */
export function NativeQuestionComposer(props: NativeQuestionComposerProps): ReactElement {
  const { requestKey, questions, locale, disabled, onAnswer, onCancel } = props
  const dictionary: Record<string, string> = locale === 'zh'
    ? { ...commonZh, ...zh }
    : { ...commonEn, ...en }
  const t: TranslateNS<'question'> = (key, params) => formatLocaleTemplate(dictionary[key] ?? key, params)
  const pending: QuestionPresentation = { key: requestKey, questions, answer: onAnswer, cancel: onCancel }
  const review = useMemo(() => planReviewOf(questions), [questions])
  const initialProgress = useMemo<QuestionDraftProgress>(() => ({
    index: 0,
    drafts: questions.map(() => ({ selected: [], custom: '', skipped: false })),
  }), [questions])
  const [progress, setProgress] = useState(initialProgress)
  return review === undefined
    ? createElement(QuestionFlow, {
      pending, t, progress, onProgress: setProgress, disabled, releaseBusyOnResolve: true,
    })
    : createElement(PlanReviewPanel, {
      pending, review, t, disabled, releaseBusyOnResolve: true,
    })
}
