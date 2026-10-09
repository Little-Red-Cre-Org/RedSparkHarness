import type { SessionHeader } from '@deepseek-ai/dsh-session/types'

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
}
