/** Follow new conversation content only while the reader remains at the bottom. */
import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** Mount with a Session key so changing conversations starts at the latest message. */
export function ConversationHistory({ children, label }: { children: ReactNode; label: string }) {
  const container = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const scrollToLatest = (): void => {
    const element = container.current
    if (element !== null && following.current) element.scrollTop = element.scrollHeight
  }
  useLayoutEffect(scrollToLatest, [children])
  return <div ref={container} className="conversation-history" tabIndex={0} aria-label={label}
    onLoadCapture={scrollToLatest}
    onScroll={(event) => {
      const element = event.currentTarget
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    }}>{children}</div>
}
