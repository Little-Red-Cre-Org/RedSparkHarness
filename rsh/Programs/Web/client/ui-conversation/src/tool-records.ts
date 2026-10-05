/** Pure Tool card vocabulary shared by native and compatibility renderers. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'

/** A tool result paired (when in-window) with its call head. */
export interface ToolResultNode {
  kind: 'tool-result'
  seq: number
  /** Unix epoch ms from the tool/result session event. */
  time: number
  callId: string
  /** Parent Tool call for a Code Dispatch result; absent on a root Session result. */
  parentCallId?: string
  /** Call head backfilled from the in-window tool/call; null when window truncation left the call outside (card head shows callId). */
  call: { name: string; argsRaw: string } | null
  /** Unix epoch ms of the paired tool/call when the call is still in-window; used for call-row duration. */
  callTime: number | null
  content: readonly ContentBlock[]
  isError: boolean
  error?: { name: string; code: string }
  meta?: unknown
  /** Child calls owned by this call, in dispatch order. */
  subCalls: readonly ToolCallBlock[]
}

/** In-flight tool card material: tool/call seen, tool/result not yet. */
export interface RunningToolCall {
  callId: string
  /** Parent Tool call for a Code Dispatch start; absent on a root Session call. */
  parentCallId?: string
  name: string
  argsRaw: string
  turn: number
  step: number
  /** Unix epoch ms when the tool/call event was logged. */
  time: number
  /** Child calls owned by this call, in dispatch order. */
  subCalls: readonly ToolCallBlock[]
}

/** One running or settled call, recursively owning its child calls. */
export type ToolCallBlock = RunningToolCall | ToolResultNode

/** Where in a file an open should land. */
export interface OpenFileOptions {
  /** 1-based line to reveal; absent = the file's beginning. */
  readonly line?: number
}

/**
 * One image inside a message record: a durable admitted reference, or the
 * local preview of a submission echo whose admission is still in flight.
 */
export type MessageImageSource =
  | { readonly attachment: ImageAttachmentRef }
  | {
    readonly preview: {
      /** Browser-owned preview URL (lifecycle stays with the submitter). */
      readonly url: string
      readonly name?: string
      /** Intrinsic pixel width, when the intake probe has resolved it. */
      readonly width?: number
      /** Intrinsic pixel height, when the intake probe has resolved it. */
      readonly height?: number
    }
  }

/** Durable image loader with an optional synchronous cache read. */
export type MessageImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek?: (attachment: ImageAttachmentRef) => string | undefined
}
