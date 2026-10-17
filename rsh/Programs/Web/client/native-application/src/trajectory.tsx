/** Inline Native Session trajectory panel. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { NativeTrajectoryView } from '@deepseek-ai/dsh-client-ui-trajectory/native'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
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
