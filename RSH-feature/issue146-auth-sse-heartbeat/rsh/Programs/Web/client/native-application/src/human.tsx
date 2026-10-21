/** Human input cards project pending Host requests without Session write authority. */
import { NativeApprovalCard } from '@deepseek-ai/dsh-client-ui-approval/native'
import { NativeQuestionComposer } from '@deepseek-ai/dsh-client-ui-user-questions/native'
import type { NativeWebHumanPrompt } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeConversationController } from './controller.ts'

/** Render the Native approval or question presentation with the existing Host answer API.
 * @param props - observed prompt, answer callback, submission state and locale.
 * @returns the shared approval or question card.
 */
export function HumanInteraction({ answerHuman, prompt, disabled, locale }: {
  answerHuman: NativeConversationController['answerHuman']
  prompt: NativeWebHumanPrompt
  disabled: boolean
  locale: 'en' | 'zh'
}) {
  if (prompt.kind === 'approval') return <NativeApprovalCard
    presentationKey={String(prompt.id)} toolName={prompt.toolName} reason={prompt.reason}
    disabled={disabled} locale={locale}
    onAllowSession={prompt.canAllowSession === true
      ? () => { void answerHuman(prompt, { kind: 'approval', outcome: 'allowed-session' }) } : undefined}
    onAnswer={(outcome) => { void answerHuman(prompt, { kind: 'approval', outcome }) }} />
  return <NativeQuestionComposer
    requestKey={String(prompt.id)} questions={prompt.questions} disabled={disabled} locale={locale}
    onCancel={() => answerHuman(prompt, { kind: 'cancel-questions' })}
    onAnswer={answer => answerHuman(prompt, { kind: 'questions', answer })} />
}
