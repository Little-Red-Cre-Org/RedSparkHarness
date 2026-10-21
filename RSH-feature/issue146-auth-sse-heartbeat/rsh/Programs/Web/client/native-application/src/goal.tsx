/** Native read-only Goal strip backed by the selected Session's event history. */

import { useMemo } from 'react'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { goalFromSessionEvents, NativeGoalBar } from '@deepseek-ai/dsh-client-ui-goal/native'

/** Render the selected Session's current durable goal when one exists.
 * @param props - current event history and Native locale.
 * @returns the read-only Goal strip, or `null` when no goal is current.
 */
export function NativeSessionGoal({ events, locale }: {
  events: readonly SessionEvent[]
  locale: 'en' | 'zh'
}) {
  const goal = useMemo(() => goalFromSessionEvents(events), [events])
  return <NativeGoalBar goal={goal} locale={locale} />
}
