/** Shared, Cordis-free chat presentation used by the legacy and Native Clients. */
import { forwardRef } from 'react'
import type {
  ButtonHTMLAttributes, HTMLAttributes, ReactNode, SelectHTMLAttributes,
} from 'react'
import clsx from 'clsx'
import css from './ChatPresentation.module.css'

/** Center the transcript and apply the shared message rhythm.
 * @param props - div attributes and optional class name.
 * @returns transcript container.
 */
export const ChatTranscript = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ChatTranscript({ className, ...props }, ref) {
    return <div ref={ref} className={clsx(css.transcript, className)} {...props} />
  },
)

/** Render a user message with the shared right-aligned attachment, bubble, and action layout.
 * @param props - message content, actions, state flags and durable event sequence.
 * @returns right-aligned user message.
 */
export function ChatUserMessage({ attachments, bubble, summary, actions, pending, echo, eventSeq }: {
  attachments?: ReactNode
  bubble?: ReactNode
  summary?: ReactNode
  actions?: ReactNode
  pending?: boolean
  echo?: boolean
  eventSeq?: number
}) {
  return (
    <div className={css.userRow} data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined} data-event-seq={eventSeq}>
      <div className={css.userStack}>
        {attachments}
        {bubble == null ? null : <div className={css.userBubble}>{bubble}</div>}
        {summary == null ? null : <div className={css.userSummary}>{summary}</div>}
      </div>
      {actions}
    </div>
  )
}

/** Frame assistant Markdown and preserve the streaming state for CSS.
 * @param props - message content, streaming state and durable event sequence.
 * @returns assistant message frame.
 */
export function ChatAssistantMessage({ children, streaming, eventSeq }: {
  children: ReactNode
  streaming?: boolean
  eventSeq?: number
}) {
  return (
    <div className={css.assistantRoot} data-streaming={streaming || undefined} data-event-seq={eventSeq}>
      <div className={css.assistantBody}>{children}</div>
    </div>
  )
}

/** Render the compact activity label shared by the legacy and Native chat views.
 * @param props - localized activity label.
 * @returns running-turn status.
 */
export function ChatTurnActivity({ children }: { children: ReactNode }) {
  return <div className={css.turnActivity} role="status" aria-live="polite">{children}</div>
}

/** Render the shared composer card while letting each Client own its editor and actions.
 * @param props - div attributes and optional class name.
 * @returns composer card container.
 */
export const ChatComposerCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ChatComposerCard({ className, ...props }, ref) {
    return <div ref={ref} className={clsx(css.composerCard, className)} data-composer-card="" {...props} />
  },
)

/** Lay out the composer's selectable options and submit actions.
 * @param props - div attributes and optional class name.
 * @returns composer toolbar container.
 */
export const ChatComposerToolbar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ChatComposerToolbar({ className, ...props }, ref) {
    return <div ref={ref} className={clsx(css.composerToolbar, className)} {...props} />
  },
)

/** Render the shared circular send or stop action.
 * @param props - button attributes, accessible label and action kind.
 * @returns circular action button.
 */
export const ChatComposerButton = forwardRef<HTMLButtonElement, {
  kind: 'send' | 'stop'
  label: string
} & ButtonHTMLAttributes<HTMLButtonElement>>(function ChatComposerButton({ kind, label, className, ...props }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} className={clsx(css.composerButton, className)} {...props}>
      {kind === 'stop'
        ? <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg>
        : <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" /></svg>}
    </button>
  )
})

/** Render a localized, token-styled select used by composer pills.
 * @param props - select attributes and the accessible label.
 * @returns labeled composer selector.
 */
export function ChatComposerSelect({ label, className, ...props }: {
  label: string
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={css.selectControl}>
      <span className={css.visuallyHidden}>{label}</span>
      <select aria-label={label} className={clsx(css.composerSelect, className)} {...props} />
    </label>
  )
}

/** Render the shared branded welcome header for an empty conversation.
 * @param props - localized hero copy and brand mark.
 * @returns welcome header.
 */
export function ChatWelcome({ eyebrow, title, badge, tagline, mark }: {
  eyebrow: string
  title: string
  badge?: string
  tagline: string
  mark: ReactNode
}) {
  return (
    <div className={css.welcome}>
      <p className={css.eyebrow}>{eyebrow}</p>
      <div className={css.headline}>
        <span className={css.markHitbox}>{mark}</span>
        <span className={css.titleGroup}>
          <span>{title}</span>
          {badge === undefined ? null : <span className={css.previewBadge}>{badge}</span>}
        </span>
      </div>
      <p className={css.tagline}>{tagline}</p>
    </div>
  )
}
