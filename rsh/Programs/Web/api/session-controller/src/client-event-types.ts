/** Cordis-free Client event types shared by event stream consumers. */
import type { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand'
import type { StreamChunk } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Client-only live chunk presentation ordered between durable Session events. */
export interface AssistantLiveChunkEvent {
  readonly type: 'assistant/live-chunk'
  readonly seq: number
  readonly time: number
  readonly data: {
    readonly attemptId: LlmAttemptId
    readonly turn: number
    readonly step: number
    readonly chunk: StreamChunk
  }
}

/** Current durable Session event or one Client-only live chunk presentation. */
export type SessionEventLike = SessionEvent | AssistantLiveChunkEvent
