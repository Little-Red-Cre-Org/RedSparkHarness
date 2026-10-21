/** Durable capability grants remain local to their originating Session, including when logs are forked. */
import type {} from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A persisted grant becomes eligible at the next model request, without changing operation permissions. */
    'tool-groups/opened': { sessionId: SessionId; group: string; tools: string[] }
  }
}
