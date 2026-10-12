/** Shared indeterminate loading feedback with required localized status text. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconLoadingOutline16 } from './icons/index.tsx'
import css from './LoadingIndicator.module.css'

/** Localized loading status and optional placement class. */
export interface LoadingIndicatorProps {
  readonly label: string
  readonly className?: string | undefined
}

/**
 * Render an animated, accessible loading status.
 * @param props - localized status label and optional placement style.
 * @returns the loading status.
 */
export function LoadingIndicator({ label, className }: LoadingIndicatorProps): ReactNode {
  return <span className={clsx(css.loading, className)} role="status" data-document-loading>
    <span className={css.icon} aria-hidden="true"><IconLoadingOutline16 /></span>
    <span>{label}</span>
  </span>
}
