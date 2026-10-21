/** Cordis-free approval cards for Native Client consumers. */
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@deepseek-ai/dsh-client-locale/dictionary'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, type ReactElement } from 'react'
import { ApprovalCard } from './ApprovalCard.tsx'
import { en, zh, type ApprovalKey } from './client/locales.ts'

/** Render the shared approval card from Native prompt fields.
 * @param props - approval request, locale and available answer callbacks.
 * @returns the localized approval card.
 */
export function NativeApprovalCard(props: {
  readonly presentationKey?: string
  readonly toolName: string
  readonly reason?: string | undefined
  readonly disabled: boolean
  readonly locale: 'en' | 'zh'
  readonly onAnswer: (outcome: 'allowed-once' | 'rejected') => void
  readonly onAllowSession?: (() => void) | undefined
}): ReactElement {
  const { locale, ...card } = props
  const dictionary: Record<string, string> = locale === 'zh'
    ? { ...commonZh, ...zh }
    : { ...commonEn, ...en }
  const t: TranslateNS<'approval'> = (key, params) => formatLocaleTemplate(dictionary[key as ApprovalKey] ?? key, params)
  return createElement(ApprovalCard, { ...card, detail: null, t })
}
