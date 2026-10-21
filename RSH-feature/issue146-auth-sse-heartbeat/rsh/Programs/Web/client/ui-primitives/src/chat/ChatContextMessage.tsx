import { useState } from 'react'
import type { ReactNode } from 'react'
import { DisclosureRow } from '../DisclosureRow.tsx'
import { IconContextInjectionOutline16 } from '../icons/index.tsx'
import { ReferenceIcon } from '../ReferenceIcon.tsx'
import css from './ChatContextMessage.module.css'

/** Plain chat context disclosure shared by the compatibility and Native views. */
export interface ChatContextMessageProps {
  role: 'inject' | 'recall'
  title: string
  source: string | null
  summary?: string | null
  bodyFormat?: string | undefined
  children: ReactNode
}

/**
 * Render a compact, expandable row for model context that did not come from the user.
 * @param props - Context labels and the expanded content.
 * @returns A collapsed context row and its bounded body.
 */
export function ChatContextMessage({ role, title, source, summary = null, bodyFormat, children }: ChatContextMessageProps) {
  const [open, setOpen] = useState(false)
  return (
    <DisclosureRow
      className={css.root}
      icon={role === 'recall'
        ? <span data-context-recall-icon><ReferenceIcon kind="session" /></span>
        : <IconContextInjectionOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={title}
      collapsedContent={source === null ? undefined : (
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.source} data-context-source>{source}</span>
          {summary === null ? null : <>
            <span className={css.sep} aria-hidden />
            <span className={css.summary} data-context-summary>{summary}</span>
          </>}
        </>
      )}
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-context-injection-body data-context-form={bodyFormat}>{children}</div>
    </DisclosureRow>
  )
}
