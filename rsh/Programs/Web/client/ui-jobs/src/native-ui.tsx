/**
 * Native entrypoint for the background-job list header action.
 *
 * The Cordis half resolves a Session's jobs from the `sessions` service; a
 * Native host has no such service, so this plugin follows the Host job feed
 * itself and keeps the list for every Session it has seen.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSessionJob, NativeSessionJobsFrame } from '@deepseek-ai/dsh-client-native-session/jobs-types'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
import type {} from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import {
  IconChevronDownOutline14, StateDot, useDismissOnOutsidePointer, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './client/JobListAction.module.css'
import { NS, en, zh, type JobKey } from './client/locales.ts'

export { NS, en, zh, en as nativeJobsEn, zh as nativeJobsZh, type JobKey } from './client/locales.ts'
export type { NativeSessionJob, NativeSessionJobsFrame }

/** Jobs grouped by owning Session. */
type JobsBySession = Readonly<Record<string, readonly NativeSessionJob[]>>

/** A job the registry still holds open, and whose duration therefore ticks. */
function isLive(job: NativeSessionJob): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Closed-union exhaustiveness fence for the wire status set. */
function assertNever(value: never): never {
  throw new Error(`unhandled job status: ${JSON.stringify(value)}`)
}

/** Status marker semantics: both request-initiated endings share the warning color. */
function dotState(status: NativeSessionJob['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'cancelled': return 'warning'
    case 'failed': return 'error'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/** Human status word for the row and its accessible name. */
function statusLabel(status: NativeSessionJob['status'], t: TranslateNS<typeof NS>): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'cancelled': return t('status.killed')
    case 'failed': return t('status.failed')
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/** Elapsed time in at most two adjacent units. */
function formatDuration(elapsedMs: number, t: TranslateNS<typeof NS>): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/**
 * Live rows first in start order, then settled rows newest-first, with the
 * start time breaking ties so the sort never depends on map iteration.
 */
function ordered(jobs: readonly NativeSessionJob[]): NativeSessionJob[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  })
}

/**
 * Fold one feed frame into the grouped projection.
 * @param current - the grouping before this frame.
 * @param frame - a baseline, upsert, remove, or session-gone frame.
 * @returns the next grouping; every branch returns a new object.
 */
export function applyJobsFrame(current: JobsBySession, frame: NativeSessionJobsFrame): JobsBySession {
  switch (frame.type) {
    case 'baseline': {
      const next: Record<string, readonly NativeSessionJob[]> = {}
      for (const row of frame.jobs) next[row.sessionId] = [...(next[row.sessionId] ?? []), row]
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
    case 'session-gone': {
      const { [frame.sessionId]: _gone, ...rest } = current
      return rest
    }
    /* v8 ignore next -- closed wire frame union */
    default: return assertNever(frame)
  }
}

/** Props every Native job action receives from the slot. */
export interface NativeJobActionProps {
  /** Session whose jobs this row shows. */
  readonly sessionId: SessionId
  /** Grouped jobs, subscribed through the slot hook. */
  readonly useJobs: SnapshotSelectorHook<JobsBySession>
  /** Namespace translator supplied by the slot. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Session-header entry point for this Session's background jobs.
 * @param props - the owning Session, the grouped-job hook and the translator.
 * @returns the trigger and its popover list, or null when there is nothing to show.
 */
export function NativeJobListAction({ sessionId, useJobs, t }: NativeJobActionProps) {
  const grouped = useJobs(value => value)
  const jobs = grouped[sessionId] ?? []
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const rows = useMemo(() => ordered(jobs), [jobs])
  const liveCount = useMemo(() => jobs.filter(isLive).length, [jobs])

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  // The clock only runs while an open list shows something that moves.
  useEffect(() => {
    if (!open || liveCount === 0) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, liveCount])

  // The last job disappearing removes this control; close first so focus does
  // not vanish from an unmounting node.
  useEffect(() => {
    if (jobs.length === 0 && open) setOpen(false)
  }, [jobs.length, open])

  if (jobs.length === 0) return null

  const countKey: JobKey = liveCount > 0
    ? (liveCount === 1 ? 'count.live.one' : 'count.live.other')
    : (jobs.length === 1 ? 'count.idle.one' : 'count.idle.other')
  const countLabel = t(countKey, { count: liveCount > 0 ? liveCount : jobs.length })

  return (
    <div ref={rootRef} className={css.root}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        onClick={() => {
          // Sample the clock in the same commit that opens the list, so the
          // first painted frame does not clamp a long-running row to zero.
          setNow(Date.now())
          setOpen(current => !current)
        }}
      >
        {liveCount > 0 ? <StateDot state="ongoing" className={css.triggerDot} /> : null}
        <span className={css.count}>{countLabel}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open
        ? (
          <ul className={css.menu} aria-label={t('list.aria')}>
            {rows.map((job) => {
              const live = isLive(job)
              const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt
              const duration = formatDuration(elapsed, t)
              const status = statusLabel(job.status, t)
              return (
                <li key={job.id} className={live ? css.row : `${css.row} ${css.rowSettled}`}>
                  <StateDot state={dotState(job.status)} className={css.rowDot} />
                  <span className={css.kind}>{job.kind}</span>
                  <span className={css.label} title={job.label}>{job.label}</span>
                  <span className={css.status} title={job.detail ?? status}>{job.detail ?? status}</span>
                  <span
                    className={css.duration}
                    title={t(live ? 'duration.title.live' : 'duration.title.done', { duration })}
                  >
                    {duration}
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

/** Native background-job list: follows the Host feed and contributes the header action. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-jobs',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeSessionJobs', 'clientNativeConversation'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const locale = context.require('clientLocale')
    const jobsClient = context.require('clientNativeSessionJobs')
    const conversation = context.require('clientNativeConversation')
    context.own(locale.register(NS, { en, zh }))
    const store = createSnapshotStore<JobsBySession>({})
    // One feed owns the whole grouping: the Host sends every Session's jobs, so
    // a per-Session follow would duplicate the stream.
    const follow = (async () => {
      try {
        for await (const frame of jobsClient.follow(context.signal)) {
          store.set(applyJobsFrame(store.getSnapshot(), frame))
        }
      } catch (error: unknown) {
        if (!context.signal.aborted) console.error('native job list: follow failed', error)
      }
    })()
    context.own(async () => { await follow })
    context.own(slots.inject('native.conversation.actions', () => slots.register({
      name: 'native.conversation.actions',
      id: 'job-list',
      order: 20,
      locale: NS,
      inject: () => ({ hooks: { jobs: store }, conversation: () => conversation.getSnapshot().selected }),
    }, ({ useJobs, conversation: readSelected, t }: {
      useJobs: SnapshotSelectorHook<JobsBySession>
      conversation: () => SessionId | undefined
      t: TranslateNS<typeof NS>
    }) => {
      const selected = readSelected()
      if (selected === undefined) return null
      return <NativeJobListAction sessionId={selected} useJobs={useJobs} t={t} />
    })))
  },
}
