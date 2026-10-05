/** Pure record props shared by native and compatibility Tool renderers. */
import type { ToolCallBlock, MessageImageSource, MessageImageLoader, OpenFileOptions } from '@deepseek-ai/dsh-client-ui-conversation/tool-records'

/** Owner currency of the Tool image gallery slot: references plus the loader. */
export interface ToolImagesOwnerProps {
  /** Durable references or submission-echo previews in result order. */
  images: readonly MessageImageSource[]
  /** Session-authorized image URL loader for the durable arm. */
  loadImage: MessageImageLoader
  /** Horizontal placement inside the owning record. */
  align: 'start' | 'end'
}

/** Standard owner currency supplied to every atomic Tool view. */
export interface ToolCallOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name and keyed dispatch value. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: ToolCallBlock
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Host account home; POSIX home-rooted summaries display as `~`. */
  home?: string | undefined
  /**
   * Open a Tool argument path. A view that knows which line the call was about
   * passes it, and the opened surface lands there.
   */
  openFile: (path: string, options?: OpenFileOptions) => void
  /**
   * Session-authorized image loader for the `tool.call.images` slot, supplied
   * by the chat node that owns this call. A composed chat node always
   * supplies it (`ChatNodeOwnerProps.loadImage` is required), so the tool
   * layer never imports an attachment implementation nor handles URL
   * authorization.
   */
  loadImage: MessageImageLoader
  /** Inspect this call in the trajectory view when available. */
  inspect?: (() => void) | undefined
}
