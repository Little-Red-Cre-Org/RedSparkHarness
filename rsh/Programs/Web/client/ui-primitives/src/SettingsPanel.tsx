/** Cordis-free Settings navigation panel shared by Client applications. */
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconClockOutline16, IconCloseOutline16, IconDataOutline16,
  IconPersonalizationOutline16, IconSettingsOutline16,
} from './icons/index.tsx'
import css from './SettingsPanel.module.css'

/** One labeled destination in a Settings panel. */
export interface SettingsPanelRow {
  readonly id: string
  readonly label: string
}

/** Props for {@link SettingsPanel}. */
export interface SettingsPanelProps {
  /** Panel title, also used as the dialog's accessible name. */
  readonly title: ReactNode
  /** Localized accessible name for the close button. */
  readonly closeLabel: ReactNode
  /** Navigation destinations in display order. */
  readonly rows: readonly SettingsPanelRow[]
  /** Currently selected destination. */
  readonly activeId: string | undefined
  /** Select one destination. */
  readonly onSelect: (id: string) => void
  /** Close the panel. */
  readonly onClose: () => void
  /** Selected page content. */
  readonly children?: ReactNode
  /** Header actions. */
  readonly actions?: ReactNode
}

/** Render the matching legacy settings-window navigation icon. */
function navIcon(id: string): ReactNode {
  if (id === 'jobs') return <IconClockOutline16 className={css.navIcon} size={16} />
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

/** Render a centered Settings dialog with navigation, focus containment, and opener restoration.
 * @param props - localized chrome, navigation, and page content.
 * @returns the dialog element tree.
 */
export function SettingsPanel({
  title, closeLabel, rows, activeId, onSelect, onClose, children, actions,
}: SettingsPanelProps) {
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id
  const titleId = useId()
  const panel = useRef<HTMLDivElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      // A child dialog portaled over Settings keeps its own Tab order.
      const dialog = (document.activeElement as Element).closest('[aria-modal="true"]')
      if (dialog !== null && dialog !== panel.current) return
      // Keep Tab inside the modal dialog: wrap at either end and pull outside focus back in.
      const root = panel.current as HTMLDivElement
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]',
      )).filter(element => element.getAttribute('tabindex') !== '-1' && element.closest('[hidden]') === null
        && (element.tagName === 'SUMMARY' || element.closest('details:not([open])') === null))
      const first = focusable[0] as HTMLElement
      const last = focusable.at(-1) as HTMLElement
      const [edge, wrap] = event.shiftKey ? [first, last] : [last, first]
      if (document.activeElement === edge || !root.contains(document.activeElement)) {
        event.preventDefault()
        wrap.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement
    closeButton.current?.focus()
    return () => { opener.focus() }
  }, [])

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div ref={panel} className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <nav className={css.nav}>
          <div className={css.navTitle} id={titleId}>{title}</div>
          <div className={css.navList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active && css.active)}
                aria-current={row.id === active ? 'true' : undefined}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.actions}>{actions}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{closeLabel}</span>
            </button>
          </div>
          <div className={css.options}>{children}</div>
        </div>
      </div>
    </div>
  )
}
