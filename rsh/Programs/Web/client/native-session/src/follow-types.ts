/** Wire presentation facts shared by the Host producer and browser Consumer. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Presentation facts from one exact admitted turn; only events are durable. */
export type NativeSessionFollowFrame =
  | { readonly type: 'event'; readonly event: SessionEvent }
  | { readonly type: 'text-start' }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'settled' }
