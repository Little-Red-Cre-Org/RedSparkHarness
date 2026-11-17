import {
  useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { ScheduleRecord } from '@redspark/rsh-schedule/client'
import {
  IconAlarmClockOutline16,
  IconChevronDownOutline14,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@redspark/rsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@redspark/rsh-client-ui-slots'
import type {} from '@redspark/rsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './ScheduleCatalogAction.module.css'
import {
  formatScheduleFrequency, formatScheduleLocalTime, formatScheduleRelative,
} from './schedule-format.ts'

export { formatScheduleFrequency, formatScheduleLocalTime, formatScheduleRelative }

/** Full props for the Session-header Schedule catalog action. */
export type ScheduleCatalogActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>

const EMPTY_RECORDS: readonly ScheduleRecord[] = []
const SECOND_MS = 1_000
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Overdue records first, then ascending target time; exact ties stay stable. */
export function orderScheduleRecords(
  records: readonly ScheduleRecord[],
  now: number,
): ScheduleRecord[] {
  return records.map((record, index) => ({ record, index })).sort((left, right) => {
    const leftTime = Date.parse(left.record.scheduledAt)
    const rightTime = Date.parse(right.record.scheduledAt)
    const leftOverdue = leftTime <= now
    const rightOverdue = rightTime <= now
    if (leftOverdue !== rightOverdue) return Number(rightOverdue) - Number(leftOverdue)
    return leftTime - rightTime || left.index - right.index
  }).map(({ record }) => record)
}

/** Read-only current-Session active reminder catalog. */
export function ScheduleCatalogAction({ useSession, useProjection, t }: ScheduleCatalogActionProps) {
  const openState = useSession(snapshot => snapshot.openState)
  const projected = useProjection('schedule')
  const records = projected ?? EMPTY_RECORDS
  const visible = openState === 'open' && records.length > 0
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const catalogRef = useRef<HTMLUListElement>(null)
  const catalogPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef: catalogRef,
    side: 'bottom',
    gap: 5,
    margin: 16,
  })

  useDismissOnOutsidePointer(rootRef, open, setOpen, catalogRef)

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, SECOND_MS)
    return () => { clearInterval(timer) }
  }, [open])

  useEffect(() => {
    if (visible || !open) return
    setOpen(false)
  }, [visible, open])

  const rows = useMemo(() => orderScheduleRecords(records, now), [records, now])

  if (!visible) return null

  const countKey = records.length === 1 ? 'trigger.one' : 'trigger.other'
  const countLabel = t(countKey, { count: records.length })
  const toggleCatalog = (): void => {
    setNow(Date.now())
    setOpen(current => !current)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={css.trigger}
      aria-expanded={open}
      aria-label={countLabel}
      onClick={toggleCatalog}
    >
      <IconAlarmClockOutline16 size={14} />
      <span className={css.count}>{countLabel}</span>
      <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
    </button>
  )
  const catalog = open
    ? createPortal((
      <ul
        ref={catalogRef}
        className={css.menu}
        style={catalogPosition ?? MEASURE_STYLE}
        aria-label={t('list.aria')}
      >
        {rows.map((record) => {
          const overdue = Date.parse(record.scheduledAt) <= now
          return (
            <li
              key={record.id}
              className={overdue ? `${css.row} ${css.rowOverdue}` : css.row}
            >
              <span className={css.status}>
                <span className={css.statusDot} aria-hidden="true" />
                <span>{t(overdue ? 'status.overdue' : 'status.scheduled')}</span>
              </span>
              <span className={css.prompt}>{record.prompt}</span>
              <span className={css.metadata}>
                <span>{formatScheduleFrequency(record, t)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatScheduleLocalTime(record.scheduledAt, document.documentElement.lang)}</span>
                <span aria-hidden="true">·</span>
                <span className={overdue ? css.relativeOverdue : undefined}>
                  {formatScheduleRelative(record.scheduledAt, now, t)}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    ), document.body)
    : null

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      {trigger}
      {catalog}
    </div>
  )
}
