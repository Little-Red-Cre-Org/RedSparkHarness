import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace-definition'

/** Title state returned beside, rather than merged into, a durable Session header. */
export type NativeSessionTitleProjection =
  | { readonly status: 'resolved'; readonly title: string }
  | { readonly status: 'absent' }
  | { readonly status: 'unavailable' }

/** One Host-ordered Session row shared by the HTTP producer and browser Consumer. */
export interface NativeSessionListItem {
  readonly header: SessionHeader
  readonly titleProjection: NativeSessionTitleProjection
  /** Mutation support delegated to the selected Host and root route. */
  readonly titleActions?: { readonly rename: boolean; readonly refresh: boolean }
  /** Latest committed Session event time, or the creation time for an empty log. */
  readonly updatedAt: number
  /** Whether a turn or scheduler notice has started the conversation. */
  readonly blank: boolean
  /** Whether the current Host Agent execution is running. */
  readonly running: boolean
  /** Whether the latest turn ended with a completed outcome. */
  readonly completed: boolean
  /** Number of currently running direct child Sessions. */
  readonly runningSubagentCount: number
  /** Current Web-owned human interaction, without its prompt contents. */
  readonly pendingInteraction?: { readonly kind: 'approval' | 'plan-review' | 'question' }
  /** Workspace membership confirmed by the Host registry. */
  readonly workspaceId?: WorkspaceId
  /** Whether an active scheduled task is visible to the current root owner. */
  readonly hasActiveSchedule: boolean
}

/** One bounded page from Session title and message search. */
export interface NativeSessionSearchPage {
  readonly items: readonly NativeSessionSearchItem[]
  /** Opaque offset for the next Host scan. */
  readonly cursor?: string
}

/** One title or message match returned by the Host. */
export interface NativeSessionSearchItem {
  readonly sessionId: SessionId
  readonly title: string
  readonly workspaceId?: WorkspaceId
  readonly cwd?: string
  readonly snippet?: string
}

/** Host update stream for the Session list. */
export type NativeSessionListFrame =
  | { readonly type: 'baseline'; readonly items: readonly NativeSessionListItem[] }
  | { readonly type: 'upsert'; readonly item: NativeSessionListItem }
  | { readonly type: 'remove'; readonly sessionId: SessionId }
