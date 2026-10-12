/** Cordis-free question records and shared presentation models. */
import type {
  AskUserQuestionAnswer, AskUserQuestionIntent, AskUserQuestionItem, AskUserQuestionOption,
} from '@deepseek-ai/dsh-user-questions/protocol'

/** Question fields consumed by the generic and plan-review cards. */
export type QuestionItem = Omit<AskUserQuestionItem, 'detail' | 'header' | 'options' | 'multiSelect' | 'intent'> & {
  detail?: string | undefined
  header?: string | undefined
  options?: readonly QuestionOption[] | undefined
  multiSelect?: boolean | undefined
  intent?: AskUserQuestionIntent | undefined
}
/** Complete structured answer batch returned to the Host. */
export type QuestionAnswer = AskUserQuestionAnswer
/** One answer choice and its optional supporting text. */
export type QuestionOption = Omit<AskUserQuestionOption, 'description'> & { description?: string | undefined }

/** One generic question's local draft. */
export interface QuestionDraftAnswer {
  selected: string[]
  custom: string
  skipped: boolean
}

/** Current question index and one draft per question. */
export interface QuestionDraftProgress {
  index: number
  drafts: QuestionDraftAnswer[]
}

/** One pending question and the actions available to its presentation. */
export interface QuestionPresentation {
  readonly key: string
  readonly questions: readonly QuestionItem[]
  answer: (answer: QuestionAnswer) => Promise<void>
  cancel?: (() => Promise<void>) | undefined
}

/** One valid single-question plan review and its supported choices. */
export interface PlanReview {
  readonly id: string
  readonly question: string
  readonly plan: string
  readonly approve: QuestionOption
  readonly decline?: QuestionOption
}

/** Narrow question requests whose complete answer set fits the plan-review card.
 * @param questions - the request's whole question batch.
 * @returns the supported plan review, or undefined for the generic flow.
 */
export function planReviewOf(questions: readonly QuestionItem[]): PlanReview | undefined {
  if (questions.length !== 1) return undefined
  const question = questions[0] as QuestionItem
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || question.detail === undefined) return undefined
  if (question.multiSelect === true) return undefined
  const options = question.options ?? []
  if (options.length > 2) return undefined
  const approve = options.find(option => option.label === intent.approve)
  if (approve === undefined) return undefined
  const decline = options.find(option => option.label !== intent.approve)
  return {
    id: question.id,
    question: question.question,
    plan: question.detail,
    approve,
    ...(decline === undefined ? {} : { decline }),
  }
}
