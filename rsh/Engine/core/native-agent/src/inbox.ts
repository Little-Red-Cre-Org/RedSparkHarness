/** Framework-independent durable pending-message list facts shared by Agent implementations. */
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type {} from '@deepseek-ai/dsh-session/types'

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * The session-projection registry applies the committed event before
     * `Session.append()` returns; Inbox live notifications follow that commit.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
  }
}
