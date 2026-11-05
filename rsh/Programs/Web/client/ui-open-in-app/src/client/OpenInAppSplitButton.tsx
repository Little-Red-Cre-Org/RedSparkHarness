import { useEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14, Menu, Tooltip, type MenuItem } from '@redspark/rsh-client-ui-primitives'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import { APP_LABEL_KEY, AppIcon, BUSY_DRESS_DELAY_MS } from './AppIcon.tsx'
import { NS, type OpenInAppKey } from './locales.ts'
import css from './OpenInAppAction.module.css'

/** Operations and resolved state the split button renders; both halves supply these. */
export interface OpenInAppSplitButtonProps {
  /** Installed app ids, or null until the Host answered. */
  readonly available: readonly string[] | null
  /** Remembered app id, empty before the first choice. */
  readonly choice: string
  /** Absolute workspace directory to open, or undefined when the Session names none. */
  readonly cwd: string | undefined
  /** Launch one app on the directory; rejects on failure so the button can report it. */
  readonly launch: (appId: string, path: string) => Promise<void>
  /** Remember one picked app id. */
  readonly choose: (appId: string) => void
  /** Host-served bundle icon URL for one catalog id. */
  readonly iconUrl: (appId: string) => string
  /** Namespace translator supplied by the slot. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * The open-in-app split button over already-resolved facts.
 *
 * Both the browser seat and the Native action row render this component; they
 * differ only in where availability, the choice, and the directory come from.
 * It renders nothing until the Host answered availability, at least one
 * installed id has a dictionary label, and a directory is known — a host
 * catalog extension without a label stays invisible rather than showing a raw id.
 * @param props - availability, choice, directory, launch carrier and translator.
 * @returns the split button and its menu, or null when there is nothing to offer.
 */
export function OpenInAppSplitButton({
  available, choice, cwd, launch, choose, iconUrl, t,
}: OpenInAppSplitButtonProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle')
  const inFlight = useRef(false)
  const busyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    clearTimeout(busyTimer.current)
    clearTimeout(errorTimer.current)
  }, [])

  const apps = (available ?? [])
    .map(id => ({ id, labelKey: APP_LABEL_KEY[id] }))
    .filter((entry): entry is { id: string; labelKey: OpenInAppKey } => entry.labelKey !== undefined)
  const currentEntry = apps.find(entry => entry.id === choice) ?? apps[0]
  if (currentEntry === undefined || cwd === undefined || cwd === '') return null

  const current = currentEntry.id
  const currentLabel = t(currentEntry.labelKey)
  const title = phase === 'error' ? t('open.error') : t('open.title', { app: currentLabel })

  const run = (appId: string): void => {
    if (inFlight.current) return
    inFlight.current = true
    // A pending error decay must not flip the button back to idle mid-launch.
    clearTimeout(errorTimer.current)
    clearTimeout(busyTimer.current)
    busyTimer.current = setTimeout(() => { setPhase('busy') }, BUSY_DRESS_DELAY_MS)
    launch(appId, cwd).then(() => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('idle')
    }, () => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('error')
      clearTimeout(errorTimer.current)
      errorTimer.current = setTimeout(() => { setPhase('idle') }, 2_000)
    })
  }

  const items: MenuItem[] = apps.map(entry => ({
    id: entry.id,
    label: t(entry.labelKey),
    icon: <AppIcon id={entry.id} url={iconUrl(entry.id)} size={18} />,
  }))

  return (
    <Menu
      open={open}
      align="end"
      dense
      selection="fill"
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={current}
      onSelect={(id) => {
        setOpen(false)
        // A pick while a launch is in flight is ignored whole: persisting the
        // choice without launching would leave the button naming an app the
        // gesture never opened.
        if (inFlight.current) return
        choose(id)
        run(id)
      }}
      anchor={(
        <div className={css.split}>
          <Tooltip label={phase === 'error' ? t('open.error') : t('open.tooltip')} side="bottom">
            <button
              type="button"
              className={css.main}
              data-state={phase}
              disabled={phase === 'busy'}
              aria-label={title}
              onClick={() => { run(current) }}
            >
              <AppIcon id={current} url={iconUrl(current)} size={15} />
            </button>
          </Tooltip>
          <button
            type="button"
            className={css.chevron}
            aria-expanded={open}
            aria-haspopup="menu"
            title={t('menu.toggle')}
            aria-label={t('menu.toggle')}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconChevronDownOutline14 size={11} />
          </button>
        </div>
      )}
    />
  )
}
