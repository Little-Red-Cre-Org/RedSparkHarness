/**
 * Native Client half of open-in-app: one Session-header split button opening
 * the selected session's workspace directory in the remembered installed
 * application.
 *
 * The Cordis half (`./client`) contributes to
 * `conversation.session.header.utilities` and reads availability from the
 * host's `/open-in-app/apps` route over plain `fetch`. Native compositions
 * render a different hole and may not have that origin, so this half:
 *
 * - registers into `native.conversation.actions`, the action row the Native
 *   shell renders beside the session heading;
 * - reads availability through the shared Connection RPC carrier
 *   (`clientConnection.rpc.response`), which resolves the Host base with the
 *   same `location.origin` fallback the Cordis controller uses;
 * - takes the workspace directory from `clientNativeConversation`, the
 *   controller whose snapshot carries the selected Session header.
 *
 * The dictionaries and the CSS module are reused from the Cordis half: they
 * hold no framework state. Everything else is native-shaped, because the
 * Cordis half's props (`useSessions`, per-entry `sessionId`) do not exist here.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { HostObservable, InjectFace, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  IconChevronDownOutline14, Menu, Tooltip, type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_ICON_PREFIX, OPEN_IN_APP_OPEN_ROUTE,
  type OpenInAppAppsPayload, type OpenInAppOpenPayload,
} from '@deepseek-ai/dsh-host-open-in-app/shared'
import type { NativeConversationSnapshot } from '@deepseek-ai/dsh-client-ui-session/native'
import { en, NS, zh, type OpenInAppKey } from './client/locales.ts'
import css from './client/OpenInAppAction.module.css'

/** Exact-Fetch carrier lifted off the shared Connection RPC channel. */
type FetchCarrier = (channel: string, endpoint: string, payload: unknown, signal: AbortSignal,
  request?: { method?: string; headers?: HeadersInit; body?: BodyInit | null }) => Promise<Response>

/** Values this contribution receives from its owning registration. */
export interface NativeOpenInAppInjected {
  hooks: {
    /** Installed app ids in host menu order; null until the host answered. */
    openInAppApps: HostObservable<readonly string[] | null>
    /** Last chosen app id, empty before the first choice. */
    openInAppChoice: HostObservable<string>
    /** Selected Session projection, source of the workspace directory to open. */
    conversation: HostObservable<NativeConversationSnapshot>
  }
  /** Launch one installed application on a workspace directory. */
  launch: (appId: string, path: string) => Promise<void>
  /** Remember one picked application id. */
  choose: (appId: string) => void
  /** Host-served PNG icon URL for one catalog id. */
  iconUrl: (appId: string) => string
}

/**
 * Props this contribution's component receives. The slot runtime synthesizes
 * one selector hook per `hooks` member (`openInAppApps` -> `useOpenInAppApps`),
 * so the component side is the inject face with `hooks` folded into hooks.
 */
export type NativeOpenInAppProps = InjectFace<NativeOpenInAppInjected> & { t: TranslateNS<typeof NS> }

/**
 * Label keys per catalog id: an id the dictionaries cannot name stays
 * invisible instead of rendering as a raw id, exactly as in the Cordis half.
 */
const APP_LABEL_KEY: Record<string, OpenInAppKey | undefined> = {
  finder: 'app.finder',
  explorer: 'app.explorer',
  filemanager: 'app.filemanager',
  cursor: 'app.cursor',
  vscode: 'app.vscode',
  vscodeinsiders: 'app.vscodeinsiders',
  windsurf: 'app.windsurf',
  zed: 'app.zed',
  sublimetext: 'app.sublimetext',
  xcode: 'app.xcode',
  androidstudio: 'app.androidstudio',
  intellij: 'app.intellij',
  pycharm: 'app.pycharm',
  webstorm: 'app.webstorm',
  phpstorm: 'app.phpstorm',
  goland: 'app.goland',
  rider: 'app.rider',
  rustrover: 'app.rustrover',
  fork: 'app.fork',
  sourcetree: 'app.sourcetree',
  github: 'app.github',
  tower: 'app.tower',
  gitkraken: 'app.gitkraken',
  smartgit: 'app.smartgit',
  sublimemerge: 'app.sublimemerge',
  ghostty: 'app.ghostty',
  warp: 'app.warp',
  iterm: 'app.iterm',
  kitty: 'app.kitty',
  terminal: 'app.terminal',
  windowsterminal: 'app.windowsterminal',
  gitbash: 'app.gitbash',
  gnometerminal: 'app.gnometerminal',
  konsole: 'app.konsole',
}

/** App ids whose icon image already failed this page; a 404 icon is fetched once, not per menu open. */
const failedIcons = new Set<string>()

/**
 * One application's real bundle icon (host-served PNG) with an inline generic
 * app-square fallback while the host has none.
 * @param props - catalog id, host icon URL, and rendered size.
 * @returns the icon image or its fallback glyph.
 */
function AppIcon({ id, url, size }: { id: string; url: string; size: number }): ReactNode {
  const [failed, setFailed] = useState(failedIcons.has(id))
  if (failed) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={1.8} className={css.icon} aria-hidden>
        <rect x={3} y={3} width={18} height={18} rx={5} />
      </svg>
    )
  }
  return (
    <img src={url} width={size} height={size} className={css.icon} alt="" aria-hidden draggable={false}
      onError={() => {
        failedIcons.add(id)
        setFailed(true)
      }}
    />
  )
}

/**
 * Quick launches settle well under this delay, so their busy dress never
 * paints — the visible dim-and-wait treatment is reserved for launches that
 * are actually taking a while, instead of flashing on every click.
 */
const BUSY_DRESS_DELAY_MS = 250

/**
 * Session-header split button: the main button opens the selected session's
 * workspace directory in the remembered application, the chevron opens the
 * menu of every application the host probed as installed. It renders nothing
 * until the host reported at least one nameable application and the session
 * has a known workspace directory, so a host without the capability never
 * grows the control.
 * @param props - injected controller face, the conversation projection, and copy.
 * @returns the split button and its menu, or null when there is nothing to offer.
 */
export function NativeOpenInAppAction(props: NativeOpenInAppProps): ReactNode {
  const { useOpenInAppApps, useOpenInAppChoice, useConversation, t } = props
  const cwd = useConversation(value => value.header?.cwd)
  const available = useOpenInAppApps(apps => apps)
  const choice = useOpenInAppChoice(id => id)
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
  const workspace = cwd

  const launch = (appId: string): void => {
    if (inFlight.current) return
    inFlight.current = true
    // A pending error decay must not flip the button back to idle mid-launch.
    clearTimeout(errorTimer.current)
    clearTimeout(busyTimer.current)
    busyTimer.current = setTimeout(() => { setPhase('busy') }, BUSY_DRESS_DELAY_MS)
    props.launch(appId, workspace).then(() => {
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
    icon: <AppIcon id={entry.id} url={props.iconUrl(entry.id)} size={18} />,
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
        props.choose(id)
        launch(id)
      }}
      anchor={(
        <div className={css.split}>
          <Tooltip label={phase === 'error' ? t('open.error') : t('open.tooltip')} side="bottom">
            <button type="button" className={css.main} data-state={phase} disabled={phase === 'busy'}
              aria-label={title} onClick={() => { launch(current) }}>
              <AppIcon id={current} url={props.iconUrl(current)} size={15} />
            </button>
          </Tooltip>
          <button type="button" className={css.chevron} aria-expanded={open} aria-haspopup="menu"
            title={t('menu.toggle')} aria-label={t('menu.toggle')}
            onClick={() => { setOpen(value => !value) }}>
            <IconChevronDownOutline14 size={11} />
          </button>
        </div>
      )}
    />
  )
}

/**
 * Availability read and launch carrier over the shared Connection RPC channel.
 * Both routes are exact Fetch routes on the Host's shared `/api` channel, so
 * the RPC carrier resolves the Host base exactly as the Cordis controller
 * does.
 */
class NativeOpenInAppController {
  /** Installed app ids in host menu order; null until the host answered. */
  readonly apps = createSnapshotStore<readonly string[] | null>(null)
  /** Last chosen app id, or empty before the first choice, shared across sessions. */
  readonly choice = createSnapshotStore<string>('', { persist: { name: 'dsh.open-in-app.choice' } })

  private loading: Promise<void> | undefined

  /**
   * @param response - exact-Fetch carrier lifted from the shared Connection RPC.
   */
  constructor(private readonly response: FetchCarrier) {}

  /**
   * Read availability once per controller life; concurrent calls share the read.
   * A failed read publishes an empty list, which renders no button at all.
   * @returns after availability is published.
   */
  load(): Promise<void> {
    this.loading ??= this.run()
    return this.loading
  }

  /**
   * Remember one picked app id.
   * @param appId - catalog id from the availability list.
   */
  choose(appId: string): void {
    this.choice.set(appId)
  }

  /**
   * Launch one installed app on a workspace directory.
   * @param appId - catalog id from the availability list.
   * @param path - the session's absolute workspace directory.
   * @returns after the host acknowledged the launch; rejects on any failure.
   */
  async launch(appId: string, path: string): Promise<void> {
    const body: OpenInAppOpenPayload = { app: appId, path }
    const response = await this.response('/api', OPEN_IN_APP_OPEN_ROUTE, undefined, new AbortController().signal, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`open failed: HTTP ${String(response.status)}`)
  }

  private async run(): Promise<void> {
    let apps: readonly string[] = []
    try {
      const response = await this.response('/api', OPEN_IN_APP_APPS_ROUTE, undefined, new AbortController().signal, {
        headers: { accept: 'application/json' },
      })
      if (response.ok) {
        const payload = await response.json() as OpenInAppAppsPayload
        if (Array.isArray(payload.apps)) apps = payload.apps.filter(id => typeof id === 'string')
      }
    } catch {
      // Swallows network failures: an unreachable host reads as no apps, and
      // the header simply shows no button rather than a broken one.
    }
    this.apps.set(apps)
  }
}

/** Host base for icon URLs, matching the connection carrier's null-origin fallback. */
const INTERNAL_BASE = 'http://dsh.internal'

/** Host-served PNG icon URL for one catalog id. */
function iconUrl(appId: string): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  const base = origin !== undefined && origin !== 'null' ? origin : INTERNAL_BASE
  return new URL(`${OPEN_IN_APP_ICON_PREFIX}/${appId}`, base).toString()
}

/** Native open-in-app Provider: the Session-header split button over the shared Conversation. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-open-in-app',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientConnection', 'clientNativeConversation'],
  optional: [],
  provides: [],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
      throw new TypeError('native open-in-app: invalid configuration')
    }
    return (context) => {
      const slots = context.require('clientSlots')
      const locale = context.require('clientLocale')
      const connection = context.require('clientConnection')
      const conversation = context.require('clientNativeConversation')
      context.own(locale.register(NS, { en, zh }))
      // `response` is optional on the carrier: a transport that cannot carry
      // exact Fetch routes leaves the button absent rather than broken.
      const carrier = connection.rpc.response
      if (carrier === undefined) return
      const controller = new NativeOpenInAppController(carrier)
      void controller.load()
      context.own(slots.inject('native.conversation.actions', () => slots.register({
        name: 'native.conversation.actions',
        id: 'open-in-app',
        order: -10,
        locale: NS,
        inject: (): NativeOpenInAppInjected => ({
          hooks: {
            openInAppApps: controller.apps,
            openInAppChoice: controller.choice,
            conversation,
          },
          launch: (appId, path) => controller.launch(appId, path),
          choose: (appId) => { controller.choose(appId) },
          iconUrl,
        }),
      }, NativeOpenInAppAction)))
    }
  },
}
