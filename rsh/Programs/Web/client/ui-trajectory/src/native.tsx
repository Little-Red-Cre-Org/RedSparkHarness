/** Cordis-free Trajectory views for Native Client consumers. */

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@deepseek-ai/dsh-client-locale/dictionary'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { TrajectoryTable } from './client/TrajectoryTable.tsx'
import type { TrajectoryTableProps } from './client/TrajectoryTable.tsx'
import { TrajectoryTimeline } from './client/TrajectoryTimeline.tsx'
import type { TrajectoryTimelineProps } from './client/TrajectoryTimeline.tsx'
import { TrajectoryTurn } from './client/TrajectoryTurn.tsx'
import type { TrajectoryTurnProps } from './client/TrajectoryTurn.tsx'
import { deriveTrajectoryLayout } from './client/layout.ts'
import { en, zh } from './client/locales.ts'
import type { TrajectoryTranslate } from './client/locales.ts'
import { deriveTrajectoryTimeline } from './client/timeline.ts'
import type { TrajectoryTimeRange } from './client/timeline.ts'
import { buildTrajectorySnapshot } from './trajectory-session-events.ts'
import css from './client/views.module.css'

export { TrajectoryTable, TrajectoryTimeline, TrajectoryTurn }
export type { TrajectoryTableProps, TrajectoryTimelineProps, TrajectoryTurnProps }
export { buildTrajectorySnapshot }
export type { TrajectorySnapshot } from './client/trajectory-contract.ts'
export type { TrajectoryTurnModel } from './client/layout.ts'
export type { TrajectoryTimeRange } from './client/timeline.ts'

/** Bind the package's English or Chinese copy to the trajectory views.
 * @param locale - dictionary language.
 * @returns the translator required by the props-only views.
 */
export function nativeTrajectoryTranslate(locale: 'en' | 'zh'): TrajectoryTranslate {
  const dictionary: Record<string, string> = locale === 'zh'
    ? { ...commonZh, ...zh }
    : { ...commonEn, ...en }
  return (key, params) => formatLocaleTemplate(dictionary[key] ?? key, params)
}

/** Props-only trajectory ledger and timing overview backed by durable events.
 * @param props - selected Session events and Native locale.
 * @returns the ledger and timeline.
 */
export function NativeTrajectoryView({ events, locale }: {
  events: readonly SessionEvent[]
  locale: 'en' | 'zh'
}) {
  const t = useMemo(() => nativeTrajectoryTranslate(locale), [locale])
  const snapshot = useMemo(() => buildTrajectorySnapshot(events), [events])
  const turns = useMemo(() => deriveTrajectoryLayout({
    nodes: snapshot.eventNodes,
    systemPrompts: snapshot.systemPrompts,
    eventLocations: snapshot.eventLocations,
    partial: snapshot.partial,
    runningCalls: snapshot.runningCalls,
    requests: snapshot.requests,
    callSchemas: snapshot.callSchemas,
  }, t), [snapshot, t])
  const [range, setRange] = useState<TrajectoryTimeRange | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(() => new Set())
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(() => new Set())
  const timeline = useMemo(() => deriveTrajectoryTimeline(turns, 'sequence'), [turns])
  const timelineFocusIndexes = useMemo(() => range === null ? null : new Set(
    timeline?.spans.filter(span => span.start <= range.end && span.end >= range.start).map(span => span.index) ?? [],
  ), [range, timeline])
  const toggleTurn = (turn: number): void => {
    setCollapsedTurns((current) => {
      const next = new Set(current)
      if (next.has(turn)) next.delete(turn)
      else next.add(turn)
      return next
    })
  }
  const toggleAssistant = (id: string): void => {
    setCollapsedAssistants((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return <div className={css.root}>
    <TrajectoryTimeline t={t} turns={turns} mode="sequence" range={range} onRangeChange={setRange}
      selectedIndex={selectedIndex} />
    <div className={css.ledger} style={{ '--dsh-trajectory-bottom-clearance': '0px' } as CSSProperties}>
      <TrajectoryTable t={t} renderImages={() => null} turns={turns}
        timelineFocusIndexes={timelineFocusIndexes} onSelectedIndexChange={setSelectedIndex}
        collapsedTurns={collapsedTurns} onToggleTurn={toggleTurn}
        collapsedAssistants={collapsedAssistants} onToggleAssistant={toggleAssistant} />
    </div>
  </div>
}
