/** Props-only transcript view used by native Client compositions. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AssistantMarkdown } from './client/chat/AssistantMarkdown.tsx'
import { ChatTranscriptColumn } from './client/chat/ChatTranscriptColumn.tsx'
import { UserMessageView } from './client/chat/native-user-message.tsx'
import { StatsPillsView } from './client/chat/StatsPillsView.tsx'
import { TurnNavigator } from './client/chat/TurnNavigator.tsx'
import css from './client/chat/ChatView.module.css'
import type {
  ChatAssistantBlock, ChatMessageContent, ChatRenderMessageImages, ChatTokenUsage, ChatTranslator,
  ChatTurnRailItem, ChatWindowStats,
} from './native-contracts.ts'

/** Durable transcript item already projected from the selected Session log. */
export type ChatViewItem =
  | { readonly kind: 'user'; readonly key: string; readonly turn: number; readonly content: ChatMessageContent }
  | {
    readonly kind: 'assistant'
    readonly key: string
    readonly turn: number
    readonly blocks: readonly ChatAssistantBlock[]
    readonly interrupted?: boolean
  }
  | { readonly kind: 'tool'; readonly key: string; readonly turn: number }

/** Data and callbacks needed to render one native Chat transcript. */
export interface ChatViewProps {
  /** Ordered user, assistant, and Tool presentation rows. */
  readonly items: readonly ChatViewItem[]
  /** Loaded Turn previews displayed in the navigation rail. */
  readonly turns: readonly ChatTurnRailItem[]
  /** Event-window timings and token totals. */
  readonly stats: ChatWindowStats
  /** Durable Session token totals, when any are available. */
  readonly usage: ChatTokenUsage | undefined
  /** Current live Assistant text, before its durable message arrives. */
  readonly liveText?: string | undefined
  /** Accessible live-output label and optional truncation notice. */
  readonly liveLabel: string
  readonly truncatedLabel?: string | undefined
  /** Render durable images through the selected native Session Consumer. */
  readonly renderMessageImages: ChatRenderMessageImages
  /** Render one Tool row produced by the owning Client's Tool presenter. */
  readonly renderTool: (key: string) => ReactNode
  /** Select a turn whose anchor is outside the loaded history window. */
  readonly onNavigate?: (item: ChatTurnRailItem) => void
  /** Chat-owned English or Chinese dictionary with common locale fallback. */
  readonly t: ChatTranslator
}

/** Render the shared Chat transcript, statistics, and loaded-turn navigator.
 * @param props - Session presentation data, image and Tool renderers, and Chat locale.
 * @returns the native Chat presentation.
 */
export function ChatView({
  items, turns, stats, usage, liveText, liveLabel, truncatedLabel, renderMessageImages,
  renderTool, onNavigate, t,
}: ChatViewProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [activeTurn, setActiveTurn] = useState<number | null>(() => turns.at(-1)?.turn ?? null)

  useEffect(() => { setActiveTurn(turns.at(-1)?.turn ?? null) }, [turns])

  const navigate = useCallback((item: ChatTurnRailItem): void => {
    if (item.anchor.kind === 'unloaded') {
      onNavigate?.(item)
      return
    }
    const list = listRef.current
    if (list === null) return
    for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
      if (row.dataset.chatAnchorKey !== item.anchor.key) continue
      row.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setActiveTurn(item.turn)
      return
    }
  }, [onNavigate])

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <TurnNavigator items={turns} activeTurn={activeTurn} busyTurn={null} onNavigate={navigate} t={t} />
        <ChatTranscriptColumn>
          {items.map(item => (
            <div
              key={item.key}
              className={css.flowItem}
              data-chat-anchor-key={item.key}
              data-chat-flow-key={item.key}
              data-chat-turn={item.turn}
            >
              {item.kind === 'user'
                ? <UserMessageView content={item.content} renderMessageImages={renderMessageImages} t={t} />
                : item.kind === 'assistant'
                  ? <AssistantMarkdown blocks={item.blocks} streaming={false} interrupted={item.interrupted}
                    renderMessageImages={renderMessageImages} t={t} />
                  : renderTool(item.key)}
            </div>
          ))}
          {liveText === undefined ? null : (
            <div className={css.flowItem} aria-label={liveLabel}>
              <AssistantMarkdown blocks={[{ kind: 'text', text: liveText }]} streaming
                renderMessageImages={renderMessageImages} t={t} />
              {truncatedLabel === undefined ? null : <p role="status">{truncatedLabel}</p>}
            </div>
          )}
        </ChatTranscriptColumn>
      </div>
      <StatsPillsView stats={stats} usage={usage} t={t} />
    </div>
  )
}
