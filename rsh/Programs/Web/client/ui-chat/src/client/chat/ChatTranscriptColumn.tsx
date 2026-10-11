import type { ReactNode } from 'react'
import css from './ChatView.module.css'

/** Center one transcript's rows on the same width axis as the Chat input. */
export function ChatTranscriptColumn({ children }: { readonly children: ReactNode }) {
  return <div className={css.column} data-chat-flow="">{children}</div>
}
