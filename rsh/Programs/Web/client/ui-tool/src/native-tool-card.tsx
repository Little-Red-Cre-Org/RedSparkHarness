/** Pure Tool cards over authoritative raw calls, results and persisted metadata. */
import { en, zh } from '@deepseek-ai/dsh-client-ui-conversation/conversation-copy'
import { en as commonEn, zh as commonZh, formatLocaleTemplate } from '@deepseek-ai/dsh-client-locale/dictionary'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { GenericToolCard } from './client/tool/toolviews/GenericToolCard.tsx'
export type { ToolCallBlock, ToolResultNode, RunningToolCall } from '@deepseek-ai/dsh-client-ui-conversation/tool-records'
import type { ToolCallOwnerProps } from './tool-renderer-types.ts'

/** Detached Tool record and locale; unavailable Host actions are omitted. */
export interface NativeToolCardProps extends Omit<ToolCallOwnerProps, 'callId' | 'openFile' | 'loadImage'>, Partial<Pick<ToolCallOwnerProps, 'callId' | 'openFile' | 'loadImage'>> {
  readonly locale: 'en' | 'zh'
}

/**
 * Render the same card models used by compatibility views without a plugin registry.
 * @param props - raw Tool record, Session workspace and explicit locale.
 * @returns localized card with only supplied action callbacks.
 */
export function NativeToolCard({ locale, ...props }: NativeToolCardProps) {
  const dictionary = locale === 'zh' ? zh : en
  const common = locale === 'zh' ? commonZh : commonEn
  const t: TranslateNS<'conversation'> = (key, params) => {
    const template = key in dictionary ? dictionary[key as keyof typeof dictionary] : common[key as keyof typeof common]
    return formatLocaleTemplate(template, params)
  }
  return <GenericToolCard {...props} t={t} />
}
