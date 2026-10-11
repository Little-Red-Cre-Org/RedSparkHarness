import type { ReactNode } from 'react'
import css from './client/skeleton/ConversationRoot.module.css'

/** Theme-backed scroll shell shared with the legacy Conversation root. */
export function ConversationShellView({ children }: { readonly children: ReactNode }) {
  return (
    <div className={css.root} data-phase="active">
      <div className={css.body}>
        <div className={css.scrollBody} data-conversation-scroll="">
          {children}
        </div>
      </div>
    </div>
  )
}
