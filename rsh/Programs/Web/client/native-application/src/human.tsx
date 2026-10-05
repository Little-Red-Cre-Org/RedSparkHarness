/** Human input cards project pending Host requests without Session write authority. */
import { useState } from 'react'
import type { NativeWebHumanPrompt } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeConversationController } from './controller.ts'
import type { ConversationLocaleKey } from './locales.ts'

/** Render one exact pending approval or question batch.
 * @param props - controller, observed presentation, submission state and locale.
 * @returns actionable pending request card.
 */
export function HumanInteraction({ controller, prompt, disabled, t }: {
  controller: NativeConversationController
  prompt: NativeWebHumanPrompt
  disabled: boolean
  t: (key: ConversationLocaleKey) => string
}) {
  const [choices, setChoices] = useState<Record<string, readonly string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  if (prompt.kind === 'approval') return <section aria-label={t('approval')}>
    <h2>{t('approval')}</h2><p>{prompt.toolName}</p>{prompt.reason === undefined ? null : <p>{prompt.reason}</p>}
    <button disabled={disabled} onClick={() => { void controller.answerHuman(prompt, { kind: 'approval', outcome: 'allowed-once' }) }}>{t('allow')}</button>
    <button disabled={disabled} onClick={() => { void controller.answerHuman(prompt, { kind: 'approval', outcome: 'rejected' }) }}>{t('deny')}</button>
  </section>
  return <form aria-label={t('questions')} onSubmit={(event) => {
    event.preventDefault()
    if (disabled) return
    void controller.answerHuman(prompt, { kind: 'questions', answer: { answers: prompt.questions.map(question => ({
      id: question.id, selected: [...choices[question.id] ?? []],
      ...custom[question.id] ? { custom: custom[question.id] } : {},
    })) } })
  }}>
    <h2>{t('questions')}</h2>
    {prompt.questions.map(question => <fieldset key={question.id} disabled={disabled}>
      <legend>{question.header ?? question.question}</legend>
      {question.header === undefined ? null : <p>{question.question}</p>}
      {question.detail === undefined ? null : <pre style={{ whiteSpace: 'pre-wrap' }}>{question.detail}</pre>}
      {(question.options ?? []).map(option => <label key={option.label} style={{ display: 'block' }}>
        <input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.id}
          checked={(choices[question.id] ?? []).includes(option.label)} onChange={(event) => {
            setChoices({ ...choices, [question.id]: question.multiSelect
              ? event.target.checked
                ? [...choices[question.id] ?? [], option.label]
                : (choices[question.id] ?? []).filter(label => label !== option.label)
              : [option.label] })
            if (!question.multiSelect) setCustom({ ...custom, [question.id]: '' })
          }} />{option.label}{option.description === undefined ? null : <span> — {option.description}</span>}
      </label>)}
      <label>{t('other')}<textarea aria-label={t('other')} value={custom[question.id] ?? ''} onChange={(event) => {
        setCustom({ ...custom, [question.id]: event.target.value })
        if (!question.multiSelect) setChoices({ ...choices, [question.id]: [] })
      }} /></label>
    </fieldset>)}
    <button type="submit" disabled={disabled}>{t('answer')}</button>
  </form>
}
