/** Native ask-user-question row over the shared card model and an explicit locale. */
import { en, zh } from '@redspark/rsh-client-ui-conversation/conversation-copy'
import { en as commonEn, zh as commonZh, formatLocaleTemplate } from '@redspark/rsh-client-locale/dictionary'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import { AskQuestionRow } from '../client/tool/toolviews/ask-question-row.tsx'
import type { ToolCallBlock } from '@redspark/rsh-client-ui-conversation/tool-records'

type AskQuestionRowComponent = (props: {
  toolName: string
  block: ToolCallBlock
  inspect?: (() => void) | undefined
  t: TranslateNS<'conversation'>
}) => ReturnType<typeof AskQuestionRow>

const Row = AskQuestionRow as unknown as AskQuestionRowComponent

/**
 * Render an `ask_user_question` call with its pending, answered, cancelled, or interrupted summary.
 * @param props - raw Tool record, an explicit locale and an optional inspect action.
 * @returns the ask row with the shared transcript card when a verdict exists.
 */
export function NativeAskQuestionRow({ block, locale, inspect }: {
  block: ToolCallBlock
  locale: 'en' | 'zh'
  inspect?: (() => void) | undefined
}) {
  const dictionary = locale === 'zh' ? zh : en
  const common = locale === 'zh' ? commonZh : commonEn
  const t: TranslateNS<'conversation'> = (key, params) => {
    const template = key in dictionary ? dictionary[key as keyof typeof dictionary] : common[key as keyof typeof common]
    return formatLocaleTemplate(template, params)
  }
  return <Row toolName="ask_user_question" block={block} t={t} {...inspect === undefined ? {} : { inspect }} />
}
