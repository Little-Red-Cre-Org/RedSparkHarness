/**
 * Native entrypoint for the Session-header "Open In..." split button.
 *
 * Both halves talk to the same Host routes through the page's Fetch carrier and
 * render the same split button, so the controller and the component are shared.
 * Only two inputs differ: the seat is the Native Session action row instead of
 * the browser header utilities, and the workspace directory comes from the
 * selected Session header's `cwd` because a Native client has no Session
 * summary projection.
 */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@redspark/rsh-client-ui-slots'
import type {} from '@redspark/rsh-client-ui-renderer/native'
import type {} from '@redspark/rsh-client-ui-session/native'
import type {} from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import { OPEN_IN_APP_ICON_PREFIX } from '@redspark/rsh-host-open-in-app/shared'
import { OpenInAppController } from './client/controller.ts'
import { OpenInAppSplitButton } from './client/OpenInAppSplitButton.tsx'
import { NS, en, zh } from './client/locales.ts'

export { NS, en, zh } from './client/locales.ts'
export type { OpenInAppKey } from './client/locales.ts'

/** Props the split button receives from the Native Session action row. */
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
 * The shared split button over Native Session facts.
 * @param props - availability, choice, directory, launch carrier and translator.
 * @returns the split button, or null when it has nothing to open.
 */
export function NativeOpenInApp({ useOpenInAppApps, useOpenInAppChoice, useWorkspacePath,
  launch, choose, iconUrl, t }: NativeOpenInAppProps) {
  return (
    <OpenInAppSplitButton
      available={useOpenInAppApps(apps => apps)}
      choice={useOpenInAppChoice(id => id)}
      cwd={useWorkspacePath(path => path)}
      launch={launch}
      choose={choose}
      iconUrl={iconUrl}
      t={t}
    />
  )
}

/** Native open-in-app: the browser split button and controller over Native Session facts. */
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
      // The split button opens the action row, before the plan chip and catalog.
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
