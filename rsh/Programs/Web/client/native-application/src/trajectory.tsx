/** Native Session trajectory inspector entry. */

import { useState } from 'react'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { NativeTrajectoryView } from '@deepseek-ai/dsh-client-ui-trajectory/native'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import css from './trajectory.module.css'

/** Open the current Session's loaded event history in a local trajectory inspector.
 * @param props - event history and locale-owned dialog copy.
 * @returns the header action and inspector dialog.
 */
export function NativeTrajectoryInspector({ events, locale, openLabel, title, closeLabel }: {
  events: readonly SessionEvent[]
  locale: NativeLocaleSnapshot['locale']
  openLabel: string
  title: string
  closeLabel: string
}) {
  const [open, setOpen] = useState(false)
  const modalProps = {
    ...(css.dialog === undefined ? {} : { className: css.dialog }),
    ...(css.content === undefined ? {} : { contentClassName: css.content }),
  }
  return <>
    <Button variant="outline" size="sm" onClick={() => { setOpen(true) }}>{openLabel}</Button>
    <Modal open={open} onClose={() => { setOpen(false) }} title={title} closeLabel={closeLabel}
      {...modalProps}>
      <NativeTrajectoryView events={events} locale={locale} />
    </Modal>
  </>
}
