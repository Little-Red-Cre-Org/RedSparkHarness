/** Native adapter from durable Session events to shared chat presentation. */
import { Fragment, useMemo } from 'react'
import { NativeWorkflowRunPanel, workflowRunsFromSessionEvents } from '@deepseek-ai/dsh-client-ui-workflow-run/native'
import {
  ChatAssistantMessage, ChatContextMessage, ChatMessageActionMeta, ChatMessageActionRow, ChatMessageCopyAction,
  ChatReasoningDisclosure, ChatTranscript, ChatTurnActivity, ChatTurnGroup, ChatUserMessage, JsonBlock, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionImage } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationSnapshot } from './controller.ts'
import { ToolCard, toolCardRecords } from './tool-cards.tsx'
import { NativeMessageImage } from './attachments.tsx'

type Translate = TranslateNS<'nativeApplication'>

interface NativeTurn {
  readonly key: string
  readonly turn: number | undefined
  readonly events: readonly SessionEvent[]
}

function eventTurn(event: SessionEvent): number | undefined {
  switch (event.type) {
    case 'step/start':
    case 'step/end':
    case 'assistant/message':
    case 'assistant/attempt':
    case 'tool/call':
    case 'tool/result':
      return event.data.turn
    default:
      return undefined
  }
}

function transcriptMessage(event: SessionEvent) {
  if (!isAppendSurfaceEvent(event) || event.type === 'tool/result') return null
  const message = deriveEventMessage(event)
  if (message === null || message.role === 'system') return null
  if (event.type === 'user/message' && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'native-time-context') return null
  return message
}

function contextSourceDetails(source: unknown): {
  role: 'inject' | 'recall'
  label: string
  summary: string | null
  form: string | undefined
} {
  const record = source as Record<string, unknown>
  const kind = String(record.kind)
  const names = record.references ?? record.changes
  const labels = Array.isArray(names) ? names.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const value = entry as Record<string, unknown>
    const label = value.label ?? value.path
    return typeof label === 'string' ? [label] : []
  }).join(', ') : ''
  return {
    role: kind === 'session-reference' ? 'recall' : 'inject',
    label: typeof record.plugin === 'string' ? record.plugin
      : typeof record.name === 'string' ? record.name : labels || kind,
    summary: typeof record.summary === 'string' ? record.summary : null,
    form: typeof record.form === 'string' ? record.form : undefined,
  }
}

/** Group consecutive rendered Session facts without reordering session-scope runs.
 * @param events - accepted live or restored Session events.
 * @param cards - root Tool presentations indexed by their call event sequence.
 * @returns ordered display segments; session-scope runs have no owning turn.
 */
export function groupNativeTranscriptEvents(
  events: readonly SessionEvent[],
  cards: ReadonlyMap<number, ReturnType<typeof toolCardRecords>[number]['block']>,
): readonly NativeTurn[] {
  const grouped: { key: string; turn: number | undefined; events: SessionEvent[] }[] = []
  let currentTurn: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') currentTurn = event.data.turn
    const turn = eventTurn(event) ?? currentTurn
    if (turn !== undefined) currentTurn = turn
    if (cards.has(event.seq) || event.type === 'tool-workflow/run-start' || transcriptMessage(event) !== null) {
      if (turn !== undefined || event.type === 'tool-workflow/run-start') {
        const previous = grouped.at(-1)
        if (turn !== undefined && previous?.turn === turn) previous.events.push(event)
        else grouped.push({ key: `${turn === undefined ? 'session' : `turn:${turn}`}:${event.seq}`, turn, events: [event] })
      }
    }
    if (event.type === 'turn/end') currentTurn = undefined
  }
  return grouped
}

function formatCount(value: number, locale: 'en' | 'zh'): string {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value)
}

function formatDuration(ms: number, t: Translate): string {
  const seconds = ms / 1_000
  if (seconds < 60) return t('durationSeconds', { seconds: Math.round(seconds * 10) / 10 })
  const whole = Math.round(seconds)
  return t('durationMinutes', { minutes: Math.floor(whole / 60), seconds: whole % 60 })
}

function formatTime(time: number, locale: 'en' | 'zh'): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(time)
}

function Message({ event, stepStartedAt, locale, t, sessionId, loadImage, markdownLabels, imageGroupClassName }: {
  event: SessionEvent
  stepStartedAt: number | undefined
  locale: 'en' | 'zh'
  t: Translate
  sessionId: SessionId
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
  markdownLabels: MarkdownLabels
  imageGroupClassName: string | undefined
}) {
  const message = transcriptMessage(event)
  if (message === null) return null
  const content = message.content.filter(block => block.type !== 'tool-call')
  if (content.length === 0 && event.type !== 'assistant/message') return null
  if (message.role === 'user') {
    if (event.type === 'user/message' && event.data.source.kind !== 'user') {
      const source = contextSourceDetails(event.data.source)
      return <ChatContextMessage role={source.role}
        title={t(source.role === 'recall' ? 'contextRecall' : 'contextInjection')}
        source={source.label} summary={source.summary} bodyFormat={source.form}>
        {content.map((block, index) => block.type === 'text'
          ? <pre key={index}>{block.text}</pre>
          : <JsonBlock key={index} label={t('extraBlock')} payload={block}
            truncatedLabel={total => t('jsonTruncated', { total })} />)}
      </ChatContextMessage>
    }
    const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
    const attachments = content.flatMap((block, index) => block.type === 'image'
      ? [<NativeMessageImage key={index} image={block.attachment} sessionId={sessionId} loadImage={loadImage} t={t} />]
      : [])
    const extra = content.filter(block => block.type !== 'image' && block.type !== 'text')
    return <ChatUserMessage eventSeq={event.seq}
      attachments={attachments.length === 0 ? undefined : <div className={imageGroupClassName}>{attachments}</div>}
      bubble={text.length === 0 ? undefined : text}
      summary={extra.length === 0 ? undefined : <JsonBlock label={t('extraBlock')} payload={extra}
        truncatedLabel={total => t('jsonTruncated', { total })} />} />
  }
  const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
  const usage = event.type === 'assistant/message' ? event.data.usage : undefined
  const totalTokens = usage === undefined ? undefined
    : usage.totalTokens ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  const stats = [
    totalTokens === undefined ? null : <ChatMessageActionMeta key="usage" label={t('tokenUsage', { count: formatCount(totalTokens, locale) })}>
      {t('tokenUsage', { count: formatCount(totalTokens, locale) })}
    </ChatMessageActionMeta>,
    event.type !== 'assistant/message' || stepStartedAt === undefined ? null
      : <ChatMessageActionMeta key="duration" label={t('durationLabel')}>
        {formatDuration(Math.max(0, event.time - stepStartedAt), t)}
      </ChatMessageActionMeta>,
    event.type !== 'assistant/message' ? null : <ChatMessageActionMeta key="time" label={t('timeLabel')}>
      {formatTime(event.time, locale)}
    </ChatMessageActionMeta>,
  ]
  const actions = event.type === 'assistant/message' ? <ChatMessageActionRow>
    {text.length === 0 ? null : <ChatMessageCopyAction text={text} copyLabel={t('copy')} copiedLabel={t('copied')} />}
    {stats}
  </ChatMessageActionRow> : undefined
  return <ChatAssistantMessage eventSeq={event.seq} actions={actions}>
    {content.map((block, index) => block.type === 'text'
      ? <MarkdownText key={index} text={block.text} labels={markdownLabels} />
      : block.type === 'reasoning'
        ? <ChatReasoningDisclosure key={index} text={block.text} title={t('reasoningDisclosure')} />
        : block.type === 'image'
          ? <NativeMessageImage key={index} image={block.attachment} sessionId={sessionId} loadImage={loadImage} t={t} />
          : <JsonBlock key={index} label={t('extraBlock')} payload={block}
            truncatedLabel={total => t('jsonTruncated', { total })} />)}
  </ChatAssistantMessage>
}

/** Render native turns, message metadata and the existing root Tool cards.
 * @param props - current Session events, image loader and locale-owned copy.
 * @returns grouped Native transcript rows.
 */
export function NativeTranscript({
  snapshot, sessionId, locale, loadImage, t, markdownLabels, imageGroupClassName, truncatedClassName, activity,
}: {
  snapshot: ConversationSnapshot
  sessionId: SessionId
  locale: 'en' | 'zh'
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
  t: Translate
  markdownLabels: MarkdownLabels
  imageGroupClassName: string | undefined
  truncatedClassName: string | undefined
  activity?: string | undefined
}) {
  const workflows = useMemo(
    () => new Map(workflowRunsFromSessionEvents(snapshot.events).map(run => [run.seq, run.data])),
    [snapshot.events],
  )
  const cards = useMemo(() => new Map(toolCardRecords(snapshot.events).map(record => [record.seq, record.block])), [snapshot.events])
  const turns = useMemo(() => groupNativeTranscriptEvents(snapshot.events, cards), [snapshot.events, cards])
  const stepStarts = useMemo(() => new Map(snapshot.events.flatMap(event =>
    event.type === 'step/start' ? [[`${event.data.turn}:${event.data.step}`, event.time] as const] : [])), [snapshot.events])
  const liveTurn = turns.at(-1)?.turn

  return <ChatTranscript>
    {turns.map(({ key, turn, events }) => {
      const rows = events.map((event) => {
        const workflow = workflows.get(event.seq)
        if (workflow !== undefined) return <NativeWorkflowRunPanel key={`${sessionId}:${event.seq}`} data={workflow} locale={locale} />
        const card = cards.get(event.seq)
        return card === undefined
          ? <Message key={event.seq} event={event}
            stepStartedAt={event.type === 'assistant/message' ? stepStarts.get(`${event.data.turn}:${event.data.step}`) : undefined}
            locale={locale} t={t} sessionId={sessionId} loadImage={loadImage} markdownLabels={markdownLabels}
            imageGroupClassName={imageGroupClassName} />
          : <ToolCard key={event.seq} block={card} locale={locale} cwd={snapshot.header?.cwd} />
      })
      return turn === undefined
        ? <Fragment key={key}>{rows}</Fragment>
        : <ChatTurnGroup key={key} turn={turn}>{rows}</ChatTurnGroup>
    })}
    {snapshot.liveText === undefined && activity === undefined ? null : <ChatTurnGroup turn={liveTurn ?? 0}>
      <ChatAssistantMessage streaming>
        {snapshot.liveText === undefined || snapshot.liveText.length === 0 ? <ChatTurnActivity>{activity ?? t('sending')}</ChatTurnActivity>
          : <MarkdownText text={snapshot.liveText} streaming labels={markdownLabels} />}
        {snapshot.liveTruncated === true ? <p className={truncatedClassName}>{t('truncated')}</p> : null}
      </ChatAssistantMessage>
    </ChatTurnGroup>}
  </ChatTranscript>
}
