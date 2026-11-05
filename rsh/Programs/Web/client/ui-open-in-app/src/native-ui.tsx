/**
 * Native entrypoint for the Session-header "Open In..." split button.
 *
 * Both halves talk to the same Host routes through the page's Fetch carrier, so
 * the availability read, the remembered choice, and the launch POST are the
 * browser half's own controller. What differs is where the button sits and where
 * the workspace directory comes from: a Native client has no Session projection,
 * so the directory is the selected Session header's `cwd` and the button joins
 * the Native Session action row.
 */
import { useEffect, useRef, useState } from 'react'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@redspark/rsh-client-ui-slots'
import type {} from '@redspark/rsh-client-ui-renderer/native'
import type {} from '@redspark/rsh-client-ui-session/native'
import type {} from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import { IconChevronDownOutline14, Menu, Tooltip, type MenuItem } from '@redspark/rsh-client-ui-primitives'
import { OPEN_IN_APP_ICON_PREFIX } from '@redspark/rsh-host-open-in-app/shared'
import { OpenInAppController } from './client/controller.ts'
import { AppIcon, APP_LABEL_KEY, BUSY_DRESS_DELAY_MS } from './client/OpenInAppAction.tsx'
import { NS, en, zh, type OpenInAppKey } from './client/locales.ts'
import css from './client/OpenInAppAction.module.css'

export { NS, en, zh, type OpenInAppKey } from './client/locales.ts'

/** Props the split button receives from the Session action row. */
export interface NativeOpenInAppProps {
  /** Installed app ids, or null until the Host answered. */
  readonly useOpenInAppApps: SnapshotSelectorHook<readonly string[] | null>
  /** Remembered app id, empty before the first choice. */
  readonly useOpenInAppChoice: SnapshotSelectorHook<string>
  /** The selected Session's absolute workspace directory, or undefined. */
  readonly useWorkspacePath: SnapshotSelectorHook<string | undefined>
  /** Launch one app on the given directory through the Host route. */
  readonly launch: (appId: string, path: string) => Promise<void>
  /** Remember one picked app id. */
  readonly choose: (appId: string) => void
  /** Host-served bundle icon URL for one catalog id. */
  readonly iconUrl: (appId: string) => string
  /** Namespace translator supplied by the slot. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * The browser half's split button over Native Session facts.
 *
 * Renders nothing until the Host has answered availability, the Session names a
 * workspace directory, and at least one installed id has a dictionary label:
 * a host catalog extension without a label stays invisible rather than showing
 * a raw id.
 * @param props - availability, choice, directory, launch carrier and translator.
 * @returns the split button, or null while it has nothing to open.
 */
export function NativeOpenInApp({ useOpenInAppApps, useOpenInAppChoice, useWorkspacePath,
  launch, choose, iconUrl, t }: NativeOpenInAppProps) {
  const available = useOpenInAppApps(apps => apps)
  const choice = useOpenInAppChoice(id => id)
  const cwd = useWorkspacePath(path => path)
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
            <IconChevronDownOutline14 size={12} />
          </button>
        </div>
      )}
    />
  )
}

/** Native open-in-app: the browser half's split button over the selected Session's directory. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-open-in-app',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeConversation'],
  optional: [],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const locale = context.require('clientLocale')
    const conversation = context.require('clientNativeConversation')
    const controller = new OpenInAppController()
    void controller.load()
    context.own(locale.register(NS, { en, zh }))
    context.own(slots.inject('native.conversation.actions', () => slots.register({
      name: 'native.conversation.actions',
      id: 'open-in-app',
      // The split button opens the header row, before the plan chip and catalog.
      order: -10,
      locale: NS,
      inject: () => ({
        hooks: {
          openInAppApps: controller.apps,
          openInAppChoice: controller.choice,
          workspacePath: {
            getSnapshot: () => conversation.getSnapshot().header?.cwd,
            subscribe: (listener: () => void) => conversation.subscribe(listener),
          },
        },
        launch: (appId: string, path: string) => controller.launch(appId, path),
        choose: (appId: string) => { controller.choose(appId) },
        iconUrl: (appId: string) => `${OPEN_IN_APP_ICON_PREFIX}/${appId}`,
      }),
    }, NativeOpenInApp)))
  },
}
