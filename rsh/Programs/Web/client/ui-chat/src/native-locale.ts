/** Typed native translations for the shared Chat transcript views. */
import type { CommonKey } from '@deepseek-ai/dsh-client-locale/dictionary'
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@deepseek-ai/dsh-client-locale/dictionary'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh } from './client/locale.ts'
import type { ChatKey } from './client/locale.ts'

export { en, zh }
export type { ChatKey }

/** Locale supported by the shared Chat transcript dictionaries. */
export type ChatLocale = 'en' | 'zh'

/** Bind Chat copy to its dictionary and the Client's common vocabulary.
 * @param locale - English or Chinese Chat dictionary selection.
 * @param common - selected locale's shared Client translator.
 * @returns a translator for Chat keys with shared Client fallback.
 */
export function createChatTranslator(locale: ChatLocale, common: Translate<CommonKey>): Translate<ChatKey | CommonKey> {
  const chat = locale === 'en' ? en : zh
  const shared = locale === 'en' ? commonEn : commonZh
  return (key, params) => key in chat
    ? formatLocaleTemplate(chat[key as ChatKey], params)
    : key in shared ? common(key as CommonKey, params) : key
}
