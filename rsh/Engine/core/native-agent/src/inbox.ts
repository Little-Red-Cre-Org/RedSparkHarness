/** Framework-independent durable pending-message list facts shared by Agent implementations. */
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type {} from '@deepseek-ai/dsh-session/types'

/** One ordered pending-message list owned by an Agent. */
export type InboxTarget = 'next-turn' | 'next-step'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One normalized durable pending-message insertion, removal or cancellation. */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
  }
}
