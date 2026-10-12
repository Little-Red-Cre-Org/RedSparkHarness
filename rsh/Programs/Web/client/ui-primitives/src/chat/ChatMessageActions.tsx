/** Shared message action row and copy control for Chat clients. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCheckOutline16, IconCopyOutline16 } from '../icons/index.tsx'
import { Tooltip } from '../Tooltip.tsx'
import { writeClipboard } from '../clipboard.ts'
import css from './ChatMessageActions.module.css'

/** Lay out copy controls and assistant message metadata.
 * @param props - action row contents and optional owner class.
 * @returns the shared action row.
 */
export function ChatMessageActionRow({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <div className={className === undefined ? css.row : `${css.row} ${className}`}
    data-chat-message-action-row="">{children}</div>
}

/** Render the shared clipboard action for one message.
 * @param props - copied text and localized labels.
 * @returns the copy button.
 */
export function ChatMessageCopyAction({ text, copyLabel, copiedLabel }: {
  text: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const epoch = useRef(0)
  useEffect(() => () => {
    epoch.current += 1
    pending.current = false
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  const copy = (): void => {
    if (copied || pending.current) return
    pending.current = true
    const copyEpoch = epoch.current
    void writeClipboard(text).then((ok) => {
      if (copyEpoch !== epoch.current) return
      pending.current = false
      if (!ok) return
      setCopied(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setCopied(false)
      }, 1000)
    })
  }
  const label = copied ? copiedLabel : copyLabel
  return <Tooltip label={label} side="bottom">
    <button type="button" className={css.action} aria-label={label} onClick={copy}>
      {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
    </button>
  </Tooltip>
}

/** Render one muted token, duration or time value beside message actions.
 * @param props - visible metadata and its accessible label.
 * @returns the metadata item.
 */
export function ChatMessageActionMeta({ children, label }: { children: ReactNode; label?: string }) {
  return <span className={css.meta} aria-label={label}>{children}</span>
}
