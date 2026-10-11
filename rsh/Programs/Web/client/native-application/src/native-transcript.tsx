/** Native adapter from durable Session events to the shared Chat transcript views. */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/native'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { ChatView, createChatTranslator, toAssistantBlocks } from '@deepseek-ai/dsh-client-ui-chat/native'
import type {
  ChatRenderMessageImages, ChatTokenUsage, ChatTurnRailItem, ChatViewItem, ChatWindowStats,
} from '@deepseek-ai/dsh-client-ui-chat/native'
import { ToolCard, toolCardRecords } from './tool-cards.tsx'
import type { ConversationSnapshot } from './controller.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

type Translate = TranslateNS<'nativeApplication'>

interface TurnPreview {
  readonly turn: number
  anchorKey?: string
  prompt: string
  response: string
}

interface TranscriptProjection {
  readonly items: readonly ChatViewItem[]
  readonly turns: readonly ChatTurnRailItem[]
}

function textOfContent(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('')
}

function textOfAssistant(blocks: readonly { readonly kind: string; readonly text?: string }[]): string {
  return blocks.flatMap(block => block.kind === 'text' && block.text !== undefined ? [block.text] : []).join('')
}

function projectTranscript(events: readonly SessionEvent[], cards: ReadonlyMap<number, ReturnType<typeof toolCardRecords>[number]['block']>): TranscriptProjection {
  const items: ChatViewItem[] = []
  const previews = new Map<number, TurnPreview>()
  let currentTurn: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') currentTurn = event.data.turn
    if (event.type === 'turn/end') currentTurn = undefined
    if (event.type === 'step/start' || event.type === 'step/end' || event.type === 'tool/call'
      || event.type === 'tool/result' || event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      currentTurn = event.data.turn
    }
    const turn = currentTurn ?? 0
    const key = `chat-${event.seq}`
    const card = cards.get(event.seq)
    if (card !== undefined) {
      items.push({ kind: 'tool', key, turn })
      const preview = turnPreview(previews, turn)
      preview.anchorKey ??= key
      continue
    }
    if (!isAppendSurfaceEvent(event) || event.type === 'system/message' || event.type === 'tool/result') continue
    const message = deriveEventMessage(event)
    if (message === null) continue
    if (message.role === 'user') {
      items.push({ kind: 'user', key, turn, content: message.content })
      const preview = turnPreview(previews, turn)
      preview.anchorKey ??= key
      if (preview.prompt === '') preview.prompt = textOfContent(message.content)
    } else if (message.role === 'assistant' && event.type === 'assistant/message') {
      const blocks = toAssistantBlocks(message.content)
      items.push({ kind: 'assistant', key, turn, blocks, interrupted: event.data.interrupted === true })
      const preview = turnPreview(previews, turn)
      preview.anchorKey ??= key
      preview.response += textOfAssistant(blocks)
    }
  }
  return {
    items,
    turns: [...previews.values()].filter((item): item is TurnPreview & { anchorKey: string } => item.anchorKey !== undefined)
      .sort((left, right) => left.turn - right.turn)
      .map(item => ({
        turn: item.turn,
        prompt: item.prompt.slice(0, 120),
        response: item.response.slice(0, 120),
        anchor: { kind: 'loaded', key: item.anchorKey },
      })),
  }
}

function turnPreview(previews: Map<number, TurnPreview>, turn: number): TurnPreview {
  let preview = previews.get(turn)
  if (preview === undefined) {
    preview = { turn, prompt: '', response: '' }
    previews.set(turn, preview)
  }
  return preview
}

function projectStats(events: readonly SessionEvent[]): { stats: ChatWindowStats; usage: ChatTokenUsage | undefined } {
  const stepStarts = new Map<string, number>()
  const callTimes = new Map<string, number>()
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  let usage: ChatTokenUsage | undefined
  for (const event of events) {
    switch (event.type) {
      case 'step/start':
        stepStarts.set(`${event.data.turn}:${event.data.step}`, event.time)
        break
      case 'step/end':
        steps += 1
        turns.add(event.data.turn)
        break
      case 'assistant/message': {
        const start = stepStarts.get(`${event.data.turn}:${event.data.step}`)
        if (start !== undefined) {
          llmMs += Math.max(0, event.time - start)
          const firstToken = assistantStreamFirstTokenTime(event.data.stream)
          if (firstToken !== undefined) {
            ttftMs += Math.max(0, firstToken - start)
            ttftSteps += 1
            if (event.data.usage !== undefined) {
              decodeMs += Math.max(0, event.time - firstToken)
              decodeTokens += event.data.usage.outputTokens
            }
          }
        }
        if (event.data.usage !== undefined) {
          usage ??= { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
          usage = {
            uncachedInputTokens: usage.uncachedInputTokens + event.data.usage.inputTokens,
            cacheReadTokens: usage.cacheReadTokens + (event.data.usage.cacheReadTokens ?? 0),
            cacheWriteTokens: usage.cacheWriteTokens + (event.data.usage.cacheWriteTokens ?? 0),
            outputTokens: usage.outputTokens + event.data.usage.outputTokens,
          }
        }
        break
      }
      case 'tool/call':
        callTimes.set(event.data.callId, event.time)
        break
      case 'tool/result': {
        const start = callTimes.get(event.data.message.source.callId)
        if (start !== undefined) toolMs += Math.max(0, event.time - start)
        break
      }
      default:
        break
    }
  }
  return {
    stats: { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens },
    usage,
  }
}

/** Render a native Session event window with the owning package's Chat views.
 * @param props - the selected conversation snapshot, locale, and image renderer.
 * @returns the transcript, turn navigator, and Session statistics.
 */
export function NativeTranscript({ snapshot, locale, renderMessageImages, t }: {
  readonly snapshot: ConversationSnapshot
  readonly locale: 'en' | 'zh'
  readonly renderMessageImages: ChatRenderMessageImages
  readonly t: Translate
}): ReactNode {
  const cards = useMemo(() => new Map(toolCardRecords(snapshot.events).map(record => [record.seq, record.block])), [snapshot.events])
  const { items, turns } = useMemo(() => projectTranscript(snapshot.events, cards), [snapshot.events, cards])
  const { stats, usage } = useMemo(() => projectStats(snapshot.events), [snapshot.events])
  const renderTool = (key: string): ReactNode => {
    const seq = Number(key.slice('chat-'.length))
    const block = cards.get(seq)
    return block === undefined ? null : <ToolCard block={block} locale={locale} cwd={snapshot.header?.cwd} />
  }
  return <ChatView
    items={items}
    turns={turns}
    stats={stats}
    usage={usage}
    liveText={snapshot.liveText}
    liveLabel={t('live')}
    truncatedLabel={snapshot.liveTruncated ? t('truncated') : undefined}
    renderMessageImages={renderMessageImages}
    renderTool={renderTool}
    t={createChatTranslator(locale, t)}
  />
}
