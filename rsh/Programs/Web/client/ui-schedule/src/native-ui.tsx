/**
 * Native entrypoint for the read-only Schedule catalog.
 *
 * The browser half renders the host-computed `schedule` projection for the open
 * Session. A Native client has no projection registry; `clientNativeSchedule`
 * follows the same Host record set as baseline/upsert/remove frames. This half
 * therefore merges those frames with the active records folded from the open
 * Session's already-read `schedule/change` events, and contributes the same
 * header action into `native.conversation.actions`.
 *
 * Row text follows the row's source: a scheduler row carries the Host's own
 * `schedule` expression, while a log row uses the browser half's
 * `formatScheduleFrequency`. Ordering and the two ISO-time formatters are the
 * browser half's own, applied to `nextRunAt`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { NativeScheduleFrame, NativeScheduledJob } from '@redspark/rsh-client-native-session/schedule-types'
import type { NativeConversationSnapshot } from '@redspark/rsh-client-ui-session/native'
import { SessionLogOffset, type SessionEvent, type SessionId } from '@redspark/rsh-session/types'
import { createSnapshotStore } from '@redspark/rsh-client-store'
import { foldScheduleEvents, ScheduleLogError } from '@redspark/rsh-schedule/domain'
import type {} from '@redspark/rsh-client-ui-renderer/native'
import type {} from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import {
  IconAlarmClockOutline16, IconChevronDownOutline14, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@redspark/rsh-client-ui-primitives'
import {
  formatScheduleFrequency, formatScheduleLocalTime, formatScheduleRelative,
} from './client/ScheduleCatalogAction.tsx'
import css from './client/ScheduleCatalogAction.module.css'
import { NS, en, zh, type ScheduleCatalogKey } from './client/locales.ts'

export { NS, en, zh, type ScheduleCatalogKey } from './client/locales.ts'

/** Rows grouped by the Session each reminder belongs to. */
export type NativeSchedulesBySession = Readonly<Record<string, readonly NativeScheduledJob[]>>

const SECOND_MS = 1_000
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Closed-union exhaustiveness fence for the wire frame set. */
function assertNever(value: never): never {
  throw new Error(`unhandled schedule frame: ${JSON.stringify(value)}`)
}

/**
 * Fold one schedule feed frame into the grouped projection.
 * @param current - the grouping before this frame.
 * @param frame - a baseline, upsert, or remove frame.
 * @returns the next grouping; every branch returns a new object.
 */
export function applyScheduleFrame(
  current: NativeSchedulesBySession,
  frame: NativeScheduleFrame,
): NativeSchedulesBySession {
  switch (frame.type) {
    case 'baseline': {
      const next: Record<string, readonly NativeScheduledJob[]> = {}
      for (const job of frame.jobs) next[job.sessionId] = [...(next[job.sessionId] ?? []), job]
      return next
    }
    case 'upsert': {
      const rows = current[frame.job.sessionId] ?? []
      const index = rows.findIndex(row => row.id === frame.job.id)
      const replaced = index === -1
        ? [...rows, frame.job]
        : rows.map((row, at) => at === index ? frame.job : row)
      return { ...current, [frame.job.sessionId]: replaced }
    }
    case 'remove': {
      const entries = Object.entries(current).flatMap(([sessionId, rows]) => {
        const kept = rows.filter(row => row.id !== frame.id)
        if (kept.length === rows.length) return [[sessionId, rows] as const]
        return kept.length === 0 ? [] : [[sessionId, kept] as const]
      })
      return Object.fromEntries(entries)
    }
    /* v8 ignore next -- closed wire frame union */
    default: return assertNever(frame)
  }
}

/** The fields this catalog renders; scheduler frames and folded log records both supply them. */
export interface NativeScheduleRow {
  /** Session-local reminder identity. */
  readonly id: string
  /** Prompt shown as the row title. */
  readonly title: string
  /** Frequency line: a Host expression or the browser formatter's text. */
  readonly schedule: string
  /** Next target instant, when the plan has one. */
  readonly nextRunAt?: number
}

/**
 * Fold the open Session's already-read events into catalog rows.
 *
 * Only events the controller already read are folded: the catalog never scans
 * persisted Sessions, adopts a published root, or wakes a cold owner. The fork
 * prefix is excluded because those reminders belong to the parent Session.
 * @param events - events loaded for the selected Session, when any.
 * @param inheritedEventCount - prefix excluded from this Session's ownership; absent means zero.
 * @param t - translator used for the frequency line.
 * @returns rows in create order; empty when the log has no active reminder or cannot be decoded.
 */
export function foldScheduleRows(
  events: readonly SessionEvent[] | undefined,
  inheritedEventCount: number | undefined,
  t: TranslateNS<typeof NS>,
): NativeScheduleRow[] {
  if (events === undefined) return []
  try {
    return foldScheduleEvents(events, SessionLogOffset(inheritedEventCount ?? 0)).active.map(record => ({
      id: record.id,
      title: record.prompt,
      schedule: formatScheduleFrequency(record, t),
      nextRunAt: Date.parse(record.scheduledAt),
    }))
  } catch (error: unknown) {
    if (error instanceof ScheduleLogError || error instanceof TypeError) return []
    throw error
  }
}

/**
 * Merge scheduler rows with folded log rows; a log row wins on a shared id.
 * @param jobs - rows from `clientNativeSchedule`.
 * @param folded - rows folded from the open Session's log.
 * @returns a new array, in scheduler order with log-only rows appended.
 */
export function mergeScheduleRows(
  jobs: readonly NativeScheduleRow[],
  folded: readonly NativeScheduleRow[],
): NativeScheduleRow[] {
  if (folded.length === 0) return [...jobs]
  const byId = new Map(jobs.map(job => [job.id, job]))
  for (const row of folded) byId.set(row.id, row)
  return [...byId.values()]
}

/** The row's target instant; a plan without one never becomes overdue. */
function targetOf(job: NativeScheduleRow): number | undefined {
  return job.nextRunAt
}

/**
 * Overdue rows first, then ascending target time, then registration order.
 *
 * Unlike the browser list this keeps rows without a target last: a paused or
 * failed plan has no next run to sort by.
 * @param jobs - the selected Session's rows.
 * @param now - the current instant, shared with the relative formatter.
 * @returns a new array in display order.
 */
export function orderNativeSchedule(
  jobs: readonly NativeScheduleRow[],
  now: number,
): NativeScheduleRow[] {
  return jobs.map((job, index) => ({ job, index })).sort((left, right) => {
    const leftAt = targetOf(left.job)
    const rightAt = targetOf(right.job)
    if (leftAt === undefined || rightAt === undefined) {
      if (leftAt !== rightAt) return leftAt === undefined ? 1 : -1
      return left.index - right.index
    }
    const leftOverdue = leftAt <= now
    const rightOverdue = rightAt <= now
    if (leftOverdue !== rightOverdue) return Number(rightOverdue) - Number(leftOverdue)
    return leftAt - rightAt || left.index - right.index
  }).map(({ job }) => job)
}

/** The Native Conversation controller slice this catalog subscribes to. */
export interface NativeConversationEvents {
  /** Read the current Conversation snapshot. */
  getSnapshot(): NativeConversationSnapshot
  /** Subscribe to Conversation snapshot changes. */
  subscribe(listener: () => void): () => void
}

/** Props the catalog receives from the Native Session action row. */
export interface NativeScheduleCatalogProps {
  /** Controller that owns the selected Session and its loaded events. */
  readonly conversation: NativeConversationEvents
  /** Grouped reminders, subscribed through the slot hook. */
  readonly useSchedules: SnapshotSelectorHook<NativeSchedulesBySession>
  /** Namespace translator supplied by the slot. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Read-only catalog of this Session's active scheduled plans.
 *
 * Rows with a target show the browser half's relative and absolute time lines;
 * a row without one (paused or failed) shows its Host state word instead.
 * @param props - the Conversation controller, the grouped-reminder hook and the translator.
 * @returns the trigger and its popover list, or null when the Session has no reminders.
 */
export function NativeScheduleCatalog({ conversation, useSchedules, t }: NativeScheduleCatalogProps) {
  const grouped = useSchedules(value => value)
  const subscribe = useCallback((listener: () => void) => conversation.subscribe(listener), [conversation])
  const getSnapshot = useCallback(() => conversation.getSnapshot(), [conversation])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const sessionId: SessionId | undefined = snapshot.selected
  const folded = useMemo(
    () => snapshot.selected === undefined
      ? []
      : foldScheduleRows(snapshot.events, snapshot.inheritedEventCount, t),
    [snapshot.selected, snapshot.events, snapshot.inheritedEventCount, t],
  )
  const jobs = useMemo(
    () => sessionId === undefined ? [] : mergeScheduleRows(grouped[sessionId] ?? [], folded),
    [grouped, sessionId, folded],
  )
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const catalogRef = useRef<HTMLUListElement>(null)
  const catalogPosition = useAnchoredPosition({
    open, anchorRef: triggerRef, panelRef: catalogRef, side: 'bottom', gap: 5, margin: 16,
  })

  useDismissOnOutsidePointer(rootRef, open, setOpen, catalogRef)

  // The clock only runs while an open list shows a target that moves.
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, SECOND_MS)
    return () => { clearInterval(timer) }
  }, [open])

  // The last reminder disappearing removes this control; close first so focus
  // does not vanish from an unmounting node.
  useEffect(() => {
    if (jobs.length === 0 && open) setOpen(false)
  }, [jobs.length, open])

  const rows = useMemo(() => orderNativeSchedule(jobs, now), [jobs, now])
  if (jobs.length === 0) return null

  const countKey: ScheduleCatalogKey = jobs.length === 1 ? 'trigger.one' : 'trigger.other'
  const countLabel = t(countKey, { count: jobs.length })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        onClick={() => {
          setNow(Date.now())
          setOpen(current => !current)
        }}
      >
        <IconAlarmClockOutline16 size={14} />
        <span className={css.count}>{countLabel}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open
        ? (
          <ul ref={catalogRef} className={css.menu}
            style={catalogPosition ?? MEASURE_STYLE} aria-label={t('list.aria')}>
            {rows.map((job) => {
              const target = targetOf(job)
              const overdue = target !== undefined && target <= now
              return (
                <li key={job.id} className={overdue ? `${css.row} ${css.rowOverdue}` : css.row}>
                  <span className={css.status}>
                    <span className={css.statusDot} aria-hidden="true" />
                    <span>{t(overdue ? 'status.overdue' : 'status.scheduled')}</span>
                  </span>
                  <span className={css.prompt}>{job.title}</span>
                  <span className={css.metadata}>
                    <span>{job.schedule}</span>
                    {target === undefined ? null : <>
                      <span aria-hidden="true">·</span>
                      <span>{formatScheduleLocalTime(new Date(target).toISOString(), document.documentElement.lang)}</span>
                      <span aria-hidden="true">·</span>
                      <span className={overdue ? css.relativeOverdue : undefined}>
                        {formatScheduleRelative(new Date(target).toISOString(), now, t)}
                      </span>
                    </>}
                  </span>
                </li>
              )
            })}
          </ul>
        )
        : null}
    </div>
  )
}

/** Native Schedule catalog: follows the Host schedule feed and contributes the header action. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-schedule',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeSchedule', 'clientNativeConversation'],
  optional: [],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const locale = context.require('clientLocale')
    const schedules = context.require('clientNativeSchedule')
    const conversation = context.require('clientNativeConversation')
    context.own(locale.register(NS, { en, zh }))
    const store = createSnapshotStore<NativeSchedulesBySession>({})
    // One feed owns every Session's reminders: the Host sends the whole set, so
    // a per-Session follow would duplicate the stream.
    const follow = (async () => {
      try {
        for await (const frame of schedules.follow(context.signal)) {
          store.set(applyScheduleFrame(store.getSnapshot(), frame))
        }
      } catch (error: unknown) {
        if (!context.signal.aborted) console.error('native schedule catalog: follow failed', error)
      }
    })()
    context.own(async () => { await follow })
    context.own(slots.inject('native.conversation.actions', () => slots.register({
      name: 'native.conversation.actions',
      id: 'schedule-catalog',
      // The plan chip precedes this entry; the background-job list follows it.
      order: 15,
      locale: NS,
      inject: () => ({ hooks: { schedules: store }, conversation }),
    }, ({ useSchedules, conversation: nativeConversation, t }: {
      useSchedules: SnapshotSelectorHook<NativeSchedulesBySession>
      conversation: NativeConversationEvents
      t: TranslateNS<typeof NS>
    }) => {
      return <NativeScheduleCatalog conversation={nativeConversation} useSchedules={useSchedules} t={t} />
    })))
  },
}
