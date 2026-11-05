// @vitest-environment jsdom
/**
 * Native Schedule catalog.
 *
 * The browser half renders the host-computed `schedule` projection for the open
 * Session. The Native half folds `clientNativeSchedule`'s baseline/upsert/remove
 * frames into the same per-Session grouping and renders from that. This suite
 * pins the fold, the ordering applied on top of it, and the row text that
 * differs between the two record sets.
 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@redspark/rsh-client-test-runtime'
import type { NativeScheduleFrame, NativeScheduledJob } from '@redspark/rsh-client-native-session/schedule-types'
import type { SessionId } from '@redspark/rsh-session/types'
import {
  applyScheduleFrame, NativeScheduleCatalog, orderNativeSchedule, plugin, type NativeSchedulesBySession,
} from '../src/native.ts'
import { zh } from '../src/client/locales.ts'

const SESSION = 'schedule-session' as SessionId
const OTHER = 'other-session' as SessionId
const START = Date.parse('2026-08-25T12:00:00.000Z')
const t = makeTranslate(zh)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  document.documentElement.lang = 'en'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * Build one catalog row.
 *
 * `nextRunAt` is optional on the wire — a paused or failed plan has none — so
 * the override decides its presence rather than assigning a possible undefined
 * under exactOptionalPropertyTypes.
 */
function job(
  id: string,
  over: Partial<Omit<NativeScheduledJob, 'nextRunAt'>> & { nextRunAt?: number | undefined } = {},
): NativeScheduledJob {
  const { nextRunAt, ...rest } = over
  return {
    id,
    sessionId: SESSION,
    title: id,
    state: 'active',
    schedule: 'every 5 minutes',
    timeZone: 'UTC',
    controllable: true,
    // Absent override means "five minutes from now"; an explicit undefined
    // override omits the key entirely, which is what a paused plan carries.
    ...(nextRunAt === undefined ? {} : { nextRunAt }),
    ...('nextRunAt' in over ? {} : { nextRunAt: START + 300_000 }),
    ...rest,
  }
}

/**
 * Build the selector hook a slot would hand the component.
 *
 * The snapshot must be reference-stable: `useSyncExternalStore` resubscribes on
 * every read that returns a new object, which would loop forever.
 */
function hookFor(grouped: NativeSchedulesBySession) {
  return (<T,>(selector: (value: NativeSchedulesBySession) => T): T =>
    useSyncExternalStore(() => () => {}, () => selector(grouped))) as never
}

function mount(grouped: NativeSchedulesBySession) {
  return render(<NativeScheduleCatalog sessionId={SESSION} useSchedules={hookFor(grouped)} t={t} />)
}

/** Rows in render order, one entry per cell that carries text. */
function rowCells(): string[][] {
  return within(screen.getByRole('list', { name: zh['list.aria'] }))
    .getAllByRole('listitem')
    .map(row => [...row.children].map(cell => cell.textContent ?? '').filter(text => text !== ''))
}

/** The relative line for one integral value and unit, as the browser formatter spells it. */
function relative(key: 'relative.future' | 'relative.overdue', value: string, unit: string): string {
  return zh[key].replace('{value}', value).replace('{unit}', unit)
}

describe('applyScheduleFrame', () => {
  it('groups a baseline by owning Session', () => {
    const next = applyScheduleFrame({}, {
      type: 'baseline',
      jobs: [job('a1'), job('a2'), job('b1', { sessionId: OTHER })],
    })
    expect(Object.keys(next).sort()).toEqual([OTHER, SESSION].sort())
    expect(next[SESSION]?.map(row => row.id)).toEqual(['a1', 'a2'])
    expect(next[OTHER]?.map(row => row.id)).toEqual(['b1'])
  })

  it('replaces an upserted row in place instead of appending a duplicate', () => {
    const start = applyScheduleFrame({}, { type: 'baseline', jobs: [job('a1')] })
    const next = applyScheduleFrame(start, {
      type: 'upsert',
      job: job('a1', { state: 'paused', title: 'renamed', nextRunAt: undefined }),
    })
    expect(next[SESSION]).toHaveLength(1)
    expect(next[SESSION]?.[0]?.title).toBe('renamed')
    expect(next[SESSION]?.[0]?.state).toBe('paused')
  })

  it('appends an upsert for a plan it has not seen', () => {
    const start = applyScheduleFrame({}, { type: 'baseline', jobs: [job('a1')] })
    expect(applyScheduleFrame(start, { type: 'upsert', job: job('a2') })[SESSION]?.map(r => r.id))
      .toEqual(['a1', 'a2'])
  })

  it('removes a row from whichever Session holds it and drops the empty bucket', () => {
    const start = applyScheduleFrame({}, { type: 'baseline', jobs: [job('a1'), job('b1', { sessionId: OTHER })] })
    const after = applyScheduleFrame(start, { type: 'remove', id: 'a1' })
    expect(after[SESSION]).toBeUndefined()
    expect(after[OTHER]?.map(row => row.id)).toEqual(['b1'])
    expect(applyScheduleFrame(after, { type: 'remove', id: 'b1' })).toEqual({})
  })

  it('never mutates the grouping it was given', () => {
    const start = applyScheduleFrame({}, { type: 'baseline', jobs: [job('a1')] })
    const before = JSON.stringify(start)
    const frames: NativeScheduleFrame[] = [
      { type: 'upsert', job: job('a2') },
      { type: 'remove', id: 'a1' },
    ]
    for (const frame of frames) applyScheduleFrame(start, frame)
    expect(JSON.stringify(start)).toBe(before)
  })
})

describe('orderNativeSchedule', () => {
  it('puts overdue rows first, then ascending targets', () => {
    const rows = orderNativeSchedule([
      job('later', { nextRunAt: START + 600_000 }),
      job('overdue', { nextRunAt: START - 60_000 }),
      job('soon', { nextRunAt: START + 60_000 }),
    ], START)
    expect(rows.map(row => row.id)).toEqual(['overdue', 'soon', 'later'])
  })

  it('keeps rows without a target last and in feed order', () => {
    const rows = orderNativeSchedule([
      job('paused', { state: 'paused', nextRunAt: undefined }),
      job('due', { nextRunAt: START + 60_000 }),
      job('failed', { state: 'failed', nextRunAt: undefined }),
    ], START)
    expect(rows.map(row => row.id)).toEqual(['due', 'paused', 'failed'])
  })
})

describe('NativeScheduleCatalog', () => {
  it('renders nothing while the Session has no reminders', () => {
    const { container } = mount({})
    expect(container.innerHTML).toBe('')
  })

  it('labels the trigger with the reminder count and opens the catalog', () => {
    mount({ [SESSION]: [job('a1'), job('a2')] })
    const trigger = screen.getByRole('button', { name: '2 个提醒' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(rowCells()).toHaveLength(2)
  })

  it('shows the Host schedule expression and marks an overdue row', () => {
    mount({ [SESSION]: [job('a1', { title: 'nightly', schedule: 'every 1 hour', nextRunAt: START - 120_000 })] })
    fireEvent.click(screen.getByRole('button'))
    const cells = rowCells()[0] as string[]
    expect(cells[0]).toBe(zh['status.overdue'])
    expect(cells[1]).toBe('nightly')
    // The metadata cell carries the frequency, the absolute target and the
    // relative line as adjacent spans, so it reads as one concatenated string.
    expect(cells[2]).toContain('every 1 hour')
    expect(cells[2]).toContain(relative('relative.overdue', '2', zh['unit.minute.other']))
  })

  it('omits both time lines for a row the Host reports without a target', () => {
    mount({ [SESSION]: [job('a1', { state: 'paused', nextRunAt: undefined })] })
    fireEvent.click(screen.getByRole('button'))
    const cells = rowCells()[0] as string[]
    expect(cells[0]).toBe(zh['status.scheduled'])
    expect(cells.slice(2)).toEqual(['every 5 minutes'])
  })

  it('advances an open catalog once per second', () => {
    mount({ [SESSION]: [job('a1', { nextRunAt: START + 30_000 })] })
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells()[0]?.join(' ')).toContain(relative('relative.future', '30', zh['unit.second.other']))

    act(() => { vi.advanceTimersByTime(10_000) })
    expect(rowCells()[0]?.join(' ')).toContain(relative('relative.future', '20', zh['unit.second.other']))
  })

  it('closes on Escape and returns focus to the trigger', () => {
    mount({ [SESSION]: [job('a1')] })
    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes and unmounts when the last reminder disappears', () => {
    const { container, rerender } = mount({ [SESSION]: [job('a1')] })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('list')).toBeDefined()

    rerender(<NativeScheduleCatalog sessionId={SESSION} useSchedules={hookFor({})} t={t} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('native Schedule installation', () => {
  it('declares the Native services it binds and provides none', () => {
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.targets).toEqual(['client'])
    expect(plugin.requires).toEqual([
      'clientSlots', 'clientLocale', 'clientNativeSchedule', 'clientNativeConversation',
    ])
    expect(plugin.optional).toEqual([])
    expect(plugin.provides).toEqual([])
  })
})
