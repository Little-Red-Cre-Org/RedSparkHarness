// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook } from '@redspark/rsh-client-ui-slots'
import type { NativeLocaleSnapshot } from '@redspark/rsh-client-locale/native'
import type {
  NativeScheduleClient, NativeScheduleFrame, NativeScheduledJob,
} from '@redspark/rsh-client-native-session/native'
import { NativeScheduledTasksPanel } from '../src/native-ui.tsx'

afterEach(cleanup)

it('renders the empty baseline and updates the list from an upsert frame', async () => {
  const job: NativeScheduledJob = {
    id: 'scheduled-test', sessionId: 'session-test' as NativeScheduledJob['sessionId'],
    title: 'Check workspace', state: 'active', schedule: '2026-10-12T12:00:00.000Z; every 3600s',
    timeZone: 'UTC', nextRunAt: Date.UTC(2026, 9, 12, 13), controllable: true,
  }
  let publish: (frame: NativeScheduleFrame | undefined) => void = () => {}
  let followSignal: AbortSignal | undefined
  const changes: string[] = []
  const client: NativeScheduleClient = {
    list: async () => [],
    // The panel is a read-only catalog today, so these exist to satisfy the
    // client contract. Recording the id keeps the day a control is added from
    // silently passing without reaching the Host.
    pause: async (id) => { changes.push(`pause:${id}`); return [] },
    resume: async (id) => { changes.push(`resume:${id}`); return [] },
    delete: async (id) => { changes.push(`delete:${id}`); return [] },
    follow(signal) {
      followSignal = signal
      return (async function* () {
        yield { type: 'baseline', jobs: [] } as const
        const frame = await new Promise<NativeScheduleFrame | undefined>((resolve) => {
          publish = resolve
          signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
        })
        if (frame !== undefined) yield frame
      })()
    },
  }
  const locale: NativeLocaleSnapshot = { locale: 'en', revision: 0 }
  const useLocale: SnapshotSelectorHook<NativeLocaleSnapshot> = selector => selector(locale)
  const t = (key: string): string => ({
    'scheduleAction': 'Scheduled tasks',
    'schedule.loading': 'Loading scheduled tasks…',
    'schedule.empty': 'No scheduled tasks.',
    'schedule.state.active': 'Scheduled',
    'schedule.nextRun': 'Next run',
  })[key] ?? key

  const view = render(<NativeScheduledTasksPanel client={client} close={() => {}} useLocale={useLocale} t={t} />)
  expect(await screen.findByText('No scheduled tasks.')).toBeTruthy()
  expect(screen.getByText('schedule.emptyHint')).toBeTruthy()
  act(() => { publish({ type: 'upsert', job }) })
  expect(await screen.findByText('Check workspace')).toBeTruthy()
  expect(screen.getByText('Scheduled')).toBeTruthy()
  expect(screen.getByText('Next run')).toBeTruthy()
  view.unmount()
  expect(followSignal?.aborted).toBe(true)
})

/**
 * The control path, asserted against a fake client rather than the real one.
 *
 * This was written first as `it.fails`, because the panel shipped no control
 * buttons and a green placeholder would have claimed coverage the product did
 * not have. The buttons exist now, so the marker is gone: this is a real
 * assertion that a click reaches the Host with the plan's own id.
 */
it('reaches the Host when a plan is paused from its card', async () => {
  const job: NativeScheduledJob = {
    id: 'plan-1', sessionId: 'session-test' as NativeScheduledJob['sessionId'],
    title: 'Check workspace', state: 'active', schedule: '2026-10-12T12:00:00.000Z',
    timeZone: 'UTC', nextRunAt: Date.UTC(2026, 9, 12, 13), controllable: true,
  }
  const pause = vi.fn(async () => [job])
  const client: NativeScheduleClient = {
    list: async () => [job],
    pause,
    resume: async () => [job],
    delete: async () => [],
    follow: async function* () { yield { type: 'baseline', jobs: [job] } },
  }
  const locale: NativeLocaleSnapshot = { locale: 'en', revision: 0 }
  const useLocale: SnapshotSelectorHook<NativeLocaleSnapshot> = selector => selector(locale)
  const t = (key: string): string => key

  render(<NativeScheduledTasksPanel client={client} close={() => {}} useLocale={useLocale} t={t} />)
  const button = await screen.findByRole('button', { name: /pause/i })
  act(() => { button.click() })
  // The id is what the Host needs to act on; a control that called pause with
  // anything else would silently do nothing.
  expect(pause).toHaveBeenCalledWith('plan-1')
})

it('offers no control at all while the owning Session is closed', async () => {
  const job: NativeScheduledJob = {
    id: 'plan-1', sessionId: 'session-test' as NativeScheduledJob['sessionId'],
    title: 'Check workspace', state: 'active', schedule: '2026-10-12T12:00:00.000Z',
    timeZone: 'UTC', nextRunAt: Date.UTC(2026, 9, 12, 13), controllable: false,
  }
  const pause = vi.fn(async () => [job])
  const client: NativeScheduleClient = {
    list: async () => [job], pause, resume: async () => [job], delete: async () => [],
    follow: async function* () { yield { type: 'baseline', jobs: [job] } },
  }
  const locale: NativeLocaleSnapshot = { locale: 'en', revision: 0 }
  const useLocale: SnapshotSelectorHook<NativeLocaleSnapshot> = selector => selector(locale)
  const t = (key: string): string => key

  render(<NativeScheduledTasksPanel client={client} close={() => {}} useLocale={useLocale} t={t} />)
  expect(await screen.findByText('Check workspace')).toBeTruthy()
  // Hidden, not disabled: a greyed control still reads as "this could work",
  // and it cannot while the Session is shut.
  expect(screen.queryByRole('button', { name: /pause/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
})

it('offers pause but never resume for a Goal plan', async () => {
  const job: NativeScheduledJob = {
    id: 'plan-1', sessionId: 'session-test' as NativeScheduledJob['sessionId'],
    title: 'Goal run', state: 'paused', schedule: '2026-10-12T12:00:00.000Z',
    timeZone: 'UTC', nextRunAt: Date.UTC(2026, 9, 12, 13), controllable: true, kind: 'goal',
  }
  const client: NativeScheduleClient = {
    list: async () => [job], pause: async () => [job], resume: async () => [job], delete: async () => [],
    follow: async function* () { yield { type: 'baseline', jobs: [job] } },
  }
  const locale: NativeLocaleSnapshot = { locale: 'en', revision: 0 }
  const useLocale: SnapshotSelectorHook<NativeLocaleSnapshot> = selector => selector(locale)
  const t = (key: string): string => key

  render(<NativeScheduledTasksPanel client={client} close={() => {}} useLocale={useLocale} t={t} />)
  expect(await screen.findByText('Goal run')).toBeTruthy()
  // Resuming a Goal needs an explicit human turn in that Session, which this
  // list is not; offering the button would only produce a guaranteed refusal.
  expect(screen.queryByRole('button', { name: /resume/i })).toBeNull()
  expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy()
})

it('arms delete on the first click and only deletes on the second', async () => {
  const job: NativeScheduledJob = {
    id: 'plan-1', sessionId: 'session-test' as NativeScheduledJob['sessionId'],
    title: 'Check workspace', state: 'active', schedule: '2026-10-12T12:00:00.000Z',
    timeZone: 'UTC', nextRunAt: Date.UTC(2026, 9, 12, 13), controllable: true,
  }
  const remove = vi.fn(async () => [])
  const client: NativeScheduleClient = {
    list: async () => [job], pause: async () => [job], resume: async () => [job],
    delete: remove,
    follow: async function* () { yield { type: 'baseline', jobs: [job] } },
  }
  const locale: NativeLocaleSnapshot = { locale: 'en', revision: 0 }
  const useLocale: SnapshotSelectorHook<NativeLocaleSnapshot> = selector => selector(locale)
  // A real dictionary for the two labels this test clicks by.
  const t = (key: string): string =>
    ({ 'schedule.delete': 'Delete', 'schedule.confirmDelete': 'Confirm delete' })[key] ?? key

  render(<NativeScheduledTasksPanel client={client} close={() => {}} useLocale={useLocale} t={t} />)
  const button = await screen.findByRole('button', { name: /delete/i })
  act(() => { button.click() })
  // First click only arms: nothing destructive has happened yet.
  expect(remove).not.toHaveBeenCalled()
  act(() => { screen.getByRole('button', { name: /confirm delete/i }).click() })
  expect(remove).toHaveBeenCalledWith('plan-1')
})

it('shows a refusal next to its own card instead of blanking the list', async () => {
  const job: NativeScheduledJob = {
    id: 'plan-1', sessionId: 'session-test' as NativeScheduledJob['sessionId'],
    title: 'Check workspace', state: 'paused', schedule: '2026-10-12T12:00:00.000Z',
    timeZone: 'UTC', nextRunAt: Date.UTC(2026, 9, 12, 13), controllable: true,
  }
  const client: NativeScheduleClient = {
    list: async () => [job],
    pause: async () => [job],
    // The Host refuses a resume that would pass the plan's end time.
    resume: () => Promise.reject(new Error('Resumed execution would reach or exceed the schedule end time')),
    delete: async () => [],
    follow: async function* () { yield { type: 'baseline', jobs: [job] } },
  }
  const locale: NativeLocaleSnapshot = { locale: 'en', revision: 0 }
  const useLocale: SnapshotSelectorHook<NativeLocaleSnapshot> = selector => selector(locale)
  const t = (key: string, params?: Record<string, unknown>): string =>
    (params === undefined ? key : `${key}:${String(params.reason)}`)

  render(<NativeScheduledTasksPanel client={client} close={() => {}} useLocale={useLocale} t={t} />)
  const button = await screen.findByRole('button', { name: /resume/i })
  await act(async () => { button.click() })
  // The store's own reason reaches the user: a benign generic message would
  // hide that nothing can resume once the window has closed.
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText(/exceed the schedule end time/u)).toBeTruthy()
  // The card itself survives: one refusal must not take the catalog down.
  expect(screen.getByText('Check workspace')).toBeTruthy()
})
