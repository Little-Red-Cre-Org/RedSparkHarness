// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import type {
  NativeScheduleClient, NativeScheduleFrame, NativeScheduledJob,
} from '@deepseek-ai/dsh-client-native-session/native'
import { NativeScheduledTasksPanel } from '../src/native-ui.tsx'

afterEach(cleanup)

it('renders the empty baseline and updates the list from an upsert frame', async () => {
  const job: NativeScheduledJob = {
    id: 'scheduled-test', sessionId: 'session-test' as NativeScheduledJob['sessionId'],
    title: 'Check workspace', state: 'active', schedule: '2026-10-12T12:00:00.000Z; every 3600s',
    timeZone: 'UTC', nextRunAt: Date.UTC(2026, 9, 12, 13),
  }
  let publish: (frame: NativeScheduleFrame | undefined) => void = () => {}
  let followSignal: AbortSignal | undefined
  const client: NativeScheduleClient = {
    list: async () => [],
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
