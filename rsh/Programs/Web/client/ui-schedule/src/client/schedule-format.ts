/** Frequency and time labels shared by the browser catalog and the Native catalog. */
import type { ScheduleRecord } from '@redspark/rsh-schedule/client'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import { NS } from './locales.ts'

type TimeUnit = 'day' | 'hour' | 'minute' | 'second'

const SECOND_MS = 1_000
const SECOND_UNIT = { unit: 'second', seconds: 1 } as const
const UNIT_SECONDS: readonly { unit: TimeUnit; seconds: number }[] = [
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
  SECOND_UNIT,
]

/** Localized unit word for one integral magnitude. */
function unitLabel(unit: TimeUnit, value: number, t: TranslateNS<typeof NS>): string {
  const keys = {
    day: ['unit.day.one', 'unit.day.other'],
    hour: ['unit.hour.one', 'unit.hour.other'],
    minute: ['unit.minute.one', 'unit.minute.other'],
    second: ['unit.second.one', 'unit.second.other'],
  } as const
  const pair = keys[unit]
  return t(value === 1 ? pair[0] : pair[1], { count: value })
}

/**
 * Pick the largest exact whole unit without rounding the durable interval.
 * @param record - durable schedule being labeled.
 * @param t - schedule-namespace translator.
 * @returns localized once or every-unit text.
 */
export function formatScheduleFrequency(
  record: ScheduleRecord,
  t: TranslateNS<typeof NS>,
): string {
  if (record.kind !== 'every') return t('frequency.once')
  let selected: { unit: TimeUnit; seconds: number } = SECOND_UNIT
  for (const candidate of UNIT_SECONDS) {
    if (record.everySeconds % candidate.seconds !== 0) continue
    selected = candidate
    break
  }
  const value = record.everySeconds / selected.seconds
  return t('frequency.every', { value, unit: unitLabel(selected.unit, value, t) })
}

/**
 * Format the durable UTC target in the browser's current locale and time zone.
 * @param scheduledAt - UTC timestamp stored on the schedule record.
 * @param locale - optional BCP 47 locale; omitted uses the browser default.
 * @returns medium date and short time.
 */
export function formatScheduleLocalTime(scheduledAt: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(Date.parse(scheduledAt))
}

/**
 * Human relative target using the largest natural clock unit.
 * @param scheduledAt - UTC timestamp stored on the schedule record.
 * @param now - comparison instant in milliseconds.
 * @param t - schedule-namespace translator.
 * @returns localized now, future, or overdue text.
 */
export function formatScheduleRelative(
  scheduledAt: string,
  now: number,
  t: TranslateNS<typeof NS>,
): string {
  const difference = Date.parse(scheduledAt) - now
  if (difference === 0) return t('relative.now')
  const absoluteSeconds = Math.abs(difference) / SECOND_MS
  const selected = UNIT_SECONDS.find(candidate => absoluteSeconds >= candidate.seconds)
    ?? SECOND_UNIT
  const value = Math.max(1, difference > 0
    ? Math.ceil(absoluteSeconds / selected.seconds)
    : Math.floor(absoluteSeconds / selected.seconds))
  const unit = unitLabel(selected.unit, value, t)
  return t(difference > 0 ? 'relative.future' : 'relative.overdue', { value, unit })
}
