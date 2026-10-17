/** Compact usage summary derived from the selected Session's loaded events. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/native'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import css from './conversation.module.css'

type Translate = TranslateNS<'nativeApplication'>

function compact(value: number, locale: NativeLocaleSnapshot['locale']): string {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value)
}

/** Show turn, step, throughput, token and cache totals for a selected Session.
 * @param props - loaded Session events, active locale, and localized copy.
 * @returns one muted line when the event window contains assistant usage.
 */
export function NativeStatusLine({ events, locale, t }: {
  events: readonly SessionEvent[]
  locale: NativeLocaleSnapshot['locale']
  t: Translate
}) {
  const turnStarts = events.filter(
    (event): event is Extract<SessionEvent, { type: 'turn/start' }> => event.type === 'turn/start')
  const assistantMessages = events.filter(
    (event): event is Extract<SessionEvent, { type: 'assistant/message' }> => event.type === 'assistant/message')
  const latestAssistant = assistantMessages.at(-1)
  const usages = assistantMessages.flatMap(event => event.data.usage === undefined ? [] : [event.data.usage])
  if (usages.length === 0) return null

  const steps = assistantMessages.length
  const totalTokens = usages.reduce((sum, usage) => sum + (usage.totalTokens
    ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)), 0)
  const hasCacheData = usages.some(usage => usage.cacheReadTokens !== undefined)
  const cacheReadTokens = usages.reduce((sum, usage) => sum + (usage.cacheReadTokens ?? 0), 0)
  const cacheTotalTokens = usages.reduce((sum, usage) => sum + usage.inputTokens
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0), 0)
  const cacheHit = !hasCacheData || cacheTotalTokens === 0
    ? undefined : Math.round(cacheReadTokens / cacheTotalTokens * 100)
  const firstTokenTime = latestAssistant === undefined
    ? undefined : assistantStreamFirstTokenTime(latestAssistant.data.stream)
  const elapsedSeconds = firstTokenTime === undefined || latestAssistant === undefined
    ? undefined : (latestAssistant.time - firstTokenTime) / 1000
  const rate = latestAssistant?.data.usage === undefined || elapsedSeconds === undefined || elapsedSeconds <= 0
    ? undefined
    : new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 0 })
      .format(latestAssistant.data.usage.outputTokens / elapsedSeconds)
  const segments = [
    t(turnStarts.length === 1 ? 'statusTurnOne' : 'statusTurns', { count: turnStarts.length }),
    t(steps === 1 ? 'statusStepOne' : 'statusSteps', { count: steps }),
    rate === undefined ? null : t('statusRate', { count: rate }),
    t('statusTotalTokens', { count: compact(totalTokens, locale) }),
    cacheHit === undefined ? null : t('statusCacheHit', { count: cacheHit }),
  ].filter((segment): segment is string => segment !== null)

  return <p className={css.statusLine}>{segments.join(' · ')}</p>
}
