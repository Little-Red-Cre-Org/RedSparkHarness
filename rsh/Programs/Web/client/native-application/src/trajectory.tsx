/** Inline Native Session trajectory panel. */
import type { SessionEvent } from '@redspark/rsh-session/types'
import { NativeTrajectoryView } from '@redspark/rsh-client-ui-trajectory/native'
import type { NativeLocaleSnapshot } from '@redspark/rsh-client-locale/native'
import css from './trajectory.module.css'

/** Render the loaded event history as the selected Session's trajectory panel.
 * @param props - loaded Session events and active locale.
 * @returns the inline ledger and timeline.
 */
export function NativeTrajectoryPanel({ events, locale }: {
  events: readonly SessionEvent[]
  locale: NativeLocaleSnapshot['locale']
}) {
  return <div className={css.panel}><NativeTrajectoryView events={events} locale={locale} /></div>
}
