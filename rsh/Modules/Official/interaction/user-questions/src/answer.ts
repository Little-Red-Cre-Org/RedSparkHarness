/** Shared question-answer JSON validation for native application transports. */
import type { AskUserQuestionAnswer, AskUserQuestionItem } from './protocol.ts'
import { UserQuestionError } from './question-error.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate a wire answer against the presented question batch.
 * @param value - untrusted answer JSON.
 * @param questions - exact pending questions.
 * @returns the validated answer.
 */
export function parseUserQuestionAnswer(value: unknown, questions: readonly AskUserQuestionItem[]): AskUserQuestionAnswer {
  if (!record(value) || Object.keys(value).some(key => key !== 'answers') || !Array.isArray(value.answers)) {
    throw new UserQuestionError('human answer must contain an answers array', 'BAD_ANSWER')
  }
  const seen = new Set<string>()
  const answers = value.answers.map((item) => {
    if (!record(item) || Object.keys(item).some(key => !['id', 'selected', 'custom'].includes(key))
      || typeof item.id !== 'string' || !Array.isArray(item.selected)
      || !item.selected.every(label => typeof label === 'string')
      || item.custom !== undefined && typeof item.custom !== 'string') {
      throw new UserQuestionError('human answer contains invalid fields', 'BAD_ANSWER')
    }
    const question = questions.find(candidate => candidate.id === item.id)
    if (question === undefined || seen.has(item.id)) throw new UserQuestionError('human answer contains an unknown or duplicate question id', 'BAD_ANSWER')
    seen.add(item.id)
    const selected = item.selected
    if (new Set(selected).size !== selected.length || selected.some(label => !question.options?.some(option => option.label === label))
      || !question.multiSelect && (selected.length > 1 || item.custom !== undefined && selected.length > 0)) {
      throw new UserQuestionError('human answer selects invalid choices', 'BAD_ANSWER')
    }
    return { id: item.id, selected: [...selected], ...item.custom === undefined ? {} : { custom: item.custom } }
  })
  if (answers.length !== questions.length) throw new UserQuestionError('human answer must include every requested question', 'BAD_ANSWER')
  return { answers }
}
