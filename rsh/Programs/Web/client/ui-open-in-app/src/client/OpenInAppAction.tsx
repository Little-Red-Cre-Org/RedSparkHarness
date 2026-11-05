import type { InjectFace, PropsLocale, PropsRuntime } from '@redspark/rsh-client-ui-slots'
import type { ObservableSnapshot } from '@redspark/rsh-client-store'
import type {} from '@redspark/rsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import { OpenInAppSplitButton } from './OpenInAppSplitButton.tsx'

export { APP_LABEL_KEY, AppIcon, BUSY_DRESS_DELAY_MS } from './AppIcon.tsx'
export { OpenInAppSplitButton } from './OpenInAppSplitButton.tsx'
export type { OpenInAppSplitButtonProps } from './OpenInAppSplitButton.tsx'

/** Browser operations and state injected into the Session Header contribution. */
export interface OpenInAppActionInjected {
  hooks: {
    openInAppApps: ObservableSnapshot<readonly string[] | null>
    openInAppChoice: ObservableSnapshot<string>
  }
  launch: (appId: string, path: string) => Promise<void>
  choose: (appId: string) => void
  iconUrl: (appId: string) => string
}

/** Full props for the Session-header open-in-app split button. */
export type OpenInAppActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<OpenInAppActionInjected>

/**
 * Session-header split button: the main button opens the session's workspace
 * directory in the remembered application, the chevron opens the menu of
 * every application the host probed as installed. The button itself is shared
 * with the Native action row; this seat only supplies the Session directory.
 * @param props - session runtime, injected controller face, and localized copy.
 * @returns the split button and its menu, or null when there is nothing to offer.
 */
export function OpenInAppAction(props: OpenInAppActionProps): React.JSX.Element | null {
  const { sessionId, useSessions, useOpenInAppApps, useOpenInAppChoice, t } = props
  return (
    <OpenInAppSplitButton
      available={useOpenInAppApps(apps => apps)}
      choice={useOpenInAppChoice(id => id)}
      cwd={useSessions(state => state.byId[sessionId]?.cwd)}
      launch={props.launch}
      choose={props.choose}
      iconUrl={props.iconUrl}
      t={t}
    />
  )
}
