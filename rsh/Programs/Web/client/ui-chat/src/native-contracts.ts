import type { ReactNode } from 'react'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ChatKey } from './client/locale.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Chat-owned transcript, message, and statistics copy. */
    chat: ChatKey
  }
}

/** Locale seat accepted by the props-only Chat views. */
export type ChatTranslator = TranslateNS<'chat'>

/** Durable or local-preview image displayed inside a message. */
export type ChatMessageImage =
  | { readonly attachment: ChatImageAttachment }
  | {
    readonly preview: {
      readonly url: string
      readonly name?: string
      readonly width?: number
      readonly height?: number
    }
  }

/** Image group and alignment passed to a transcript-owned image renderer. */
export interface ChatMessageImagesProps {
  readonly images: readonly ChatMessageImage[]
  readonly align: 'start' | 'end'
  readonly compact?: boolean
}

/** Render one Chat-owned message image group. */
export type ChatRenderMessageImages = (props: ChatMessageImagesProps) => ReactNode

/** Image attachment reference in a Session content block. */
export type ChatImageAttachment = Extract<ContentBlock, { readonly type: 'image' }>['attachment']

/** Typed user content accepted by the props-only message view. */
export type ChatMessageContent = readonly ContentBlock[]

/** Assistant content in the form consumed by the Markdown transcript view. */
export type ChatAssistantBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'image'; readonly attachment: ChatImageAttachment }
  | { readonly kind: 'tool-call'; readonly callId: string; readonly name: string; readonly argsRaw: string }
  | { readonly kind: 'other'; readonly block: unknown }

/** Event-window totals accepted by the props-only statistics pills. */
export interface ChatWindowStats {
  readonly turns: number
  readonly steps: number
  readonly llmMs: number
  readonly toolMs: number
  readonly ttftMs: number
  readonly ttftSteps: number
  readonly decodeMs: number
  readonly decodeTokens: number
}

/** Session-wide token totals used by the usage pill. */
export interface ChatTokenUsage {
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
}

/** One loaded turn mark and its transcript anchor. */
export interface ChatTurnRailItem {
  readonly turn: number
  readonly prompt: string
  readonly response: string
  readonly anchor:
    | { readonly kind: 'loaded'; readonly key: string }
    | { readonly kind: 'unloaded'; readonly seq: SessionSeq }
}

/** Optional authored-file links for one closing assistant turn. */
export type ChatMarkdownMentions = MarkdownFileMentions
