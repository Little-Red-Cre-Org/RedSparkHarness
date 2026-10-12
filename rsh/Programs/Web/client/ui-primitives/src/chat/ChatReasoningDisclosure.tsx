/** Collapsed-by-default reasoning row shared by Chat clients. */
import { useState } from 'react'
import { DisclosureRow } from '../DisclosureRow.tsx'
import { IconThinkOutline14 } from '../icons/index.tsx'
import css from './ChatReasoningDisclosure.module.css'

/** Render assistant reasoning behind a compact disclosure.
 * @param props - reasoning text, localized title and running state.
 * @returns the collapsed reasoning row.
 */
export function ChatReasoningDisclosure({ text, title, running, runningLabel }: {
  text: string
  title: string
  running?: boolean
  runningLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const newline = text.indexOf('\n')
  const summary = (running ? text.trimEnd().slice(text.trimEnd().lastIndexOf('\n') + 1)
    : newline === -1 ? text : text.slice(0, newline)).replaceAll('**', '')

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}>
      {runningLabel === undefined || !running ? null : <span className={css.visuallyHidden}>{runningLabel}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-follow-end={running || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
          </>
        )}
      >
        <div className={css.body}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
