/** Cordis-free type contracts shared by native Conversation targets. */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageImageLoader, MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/tool-records'

export type { MessageImageLoader, MessageImageSource }

/** Message image group handed to the optional attachment presentation plugin. */
export interface MessageImagesOwnerProps {
  /** Durable references or submission-echo previews in source order. */
  images: readonly MessageImageSource[]
  /** Session-authorized image URL loader for the durable arm. */
  loadImage: MessageImageLoader
  /** Horizontal placement inside the owning record. */
  align: 'start' | 'end'
  /** Force every image into the compact message-attachment tile size. */
  compact?: boolean
}

/** Slot-backed renderer used by Conversation targets without importing an attachment implementation. */
export type RenderMessageImages = (owner: Omit<MessageImagesOwnerProps, 'loadImage'>) => ReactNode

/** Base props of one target-owned Conversation View entry. */
export type ConvViewProps = PropsRuntime<'conversation.view'>
