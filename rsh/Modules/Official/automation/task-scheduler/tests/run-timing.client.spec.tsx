// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { RunTiming } from '../src/client/RunTiming.tsx'
import { zh, type SchedulerKey } from '../src/client/locales.ts'
import type { Run } from '../src/types.ts'
import type { SchedulerSnapshot } from '../src/gui-types.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

afterEach(cleanup)
const t = (key: SchedulerKey): string => zh[key]
const base = Date.parse('2026-09-16T03:16:09.950Z')
const run: SchedulerSnapshot['runs'][number] = {
  id: brandString<Run['id']>('first'), taskId: brandString<Run['taskId']>('task'),
  scheduledAt: base, startedAt: base + 70, finishedAt: base + 75,
  deadline: base + 600000, state: 'completed', sessionId: null, detail: 'Reminder dispatched', reminderStartedAt: base - 120000,
}

it('shows one reminder time without inventing an execution interval', () => {
  const { container, queryByText } = render(<RunTiming run={run} t={t} />)
  expect(container.textContent).toBe('本次提醒时间2026/9/16 11:16:10')
  expect(queryByText('本次实际开始时间')).toBeNull()
  expect(queryByText('本次完成时间')).toBeNull()
  expect(queryByText('本次提醒开始时间')).toBeNull()
  expect(queryByText('本次提醒结束时间')).toBeNull()
})

it('does not expose countdown metadata as reminder start or end times', () => {
  const { container } = render(<RunTiming run={{ ...run, reminderStartedAt: base - 300000 }} t={t} />)
  expect(container.textContent).toBe('本次提醒时间2026/9/16 11:16:10')
})

it('renders the actual reminder even when countdown metadata is missing', () => {
  const { container } = render(<RunTiming run={{ ...run, reminderStartedAt: null }} t={t} />)
  expect(container.textContent).toBe('本次提醒时间2026/9/16 11:16:10')
})

it('replaces all timing values when another receipt is expanded', () => {
  const { container, rerender } = render(<RunTiming run={run} t={t} />)
  const next = Date.parse('2026-09-16T04:22:45.000Z')
  rerender(<RunTiming run={{ ...run, id: brandString<Run['id']>('second'), reminderStartedAt: next, scheduledAt: next, startedAt: next, finishedAt: next }} t={t} />)
  expect(container.textContent).not.toContain('11:16:')
  expect(container.textContent?.match(/12:22:45/gu)).toHaveLength(1)
  expect(container.textContent).not.toContain('延迟')
})

it('retains distinct planned, actual start and finish times for Agent work', () => {
  const { container } = render(<RunTiming run={{ ...run, detail: 'Finished work' }} t={t} />)
  expect(container.textContent).toMatchInlineSnapshot('"本次计划执行时间2026/9/16 11:16:09本次实际开始时间2026/9/16 11:16:10本次完成时间2026/9/16 11:16:10本次执行耗时：0 分钟本次启动延迟：不足 1 秒"')
})

it('does not present immediate goal admission as a separate planned time', () => {
  const { container } = render(<RunTiming run={{ ...run, kind: 'goal', detail: 'Working', state: 'running', finishedAt: null }} t={t} />)
  expect(container.textContent).toBe('本次实际开始时间2026/9/16 11:16:10本次结束时间尚未结束')
  expect(container.textContent).not.toContain('本次计划执行时间')
  expect(container.textContent).not.toContain('本次启动延迟')
})

it('does not invent a finish time for running work', () => {
  const { container } = render(<RunTiming run={{ ...run, state: 'running', detail: '', finishedAt: null }} t={t} />)
  expect(container.textContent).toContain('本次结束时间尚未结束')
  expect(container.textContent).not.toContain('本次执行耗时')
})
