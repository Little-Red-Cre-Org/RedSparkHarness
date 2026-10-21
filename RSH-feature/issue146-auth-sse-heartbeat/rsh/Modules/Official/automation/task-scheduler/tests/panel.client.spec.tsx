// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, fireEvent } from '@testing-library/react'
import { SchedulerPanel, type PanelProps } from '../src/client/Panel.tsx'
import { zh, en, type SchedulerKey } from '../src/client/locales.ts'
import { schedulerError } from '../src/client/errors.ts'
import type { CreateTaskRequest } from '../src/gui-types.ts'
import type { Task } from '../src/types.ts'

const t = (key: SchedulerKey): string => zh[key]
afterEach(() => { cleanup(); vi.useRealTimers() })
it('keeps the final wait active until the exact end and never falls back to the first reminder time', () => {
  vi.useFakeTimers()
  const start = Date.parse('2026-09-16T08:00:00Z')
  vi.setSystemTime(start + 20 * 60000)
  const task = { id: 'cycle', title: '喝水', state: 'active', kind: 'scheduled',
    countdownStartedAt: new Date(start).toISOString(), at: new Date(start + 300000).toISOString(),
    endAt: new Date(start + 21 * 60000).toISOString(), everySeconds: 300, nextAt: null, prompt: '每5分钟提醒我喝水' } as Task
  const state = { owners: [], owner: null, data: { tasks: [task], runs: [], minEverySeconds: 300 }, busy: false, error: null, notice: null }
  const props = { useSnapshot: (select: (value: typeof state) => unknown) => select(state), refresh: vi.fn(),
    prepareSession: vi.fn(), t, change: vi.fn(), select: vi.fn(), create: vi.fn(), deleteRun: vi.fn(),
    close: vi.fn(), viewSession: vi.fn() } as unknown as PanelProps
  const { container } = render(<SchedulerPanel {...props} />)
  const card = container.querySelector('article')!
  expect(card.textContent).toContain('周期进行中')
  expect(card.textContent).not.toContain('计划已结束')
  expect(card.textContent).not.toContain('16:05:00')
  expect(card.textContent).not.toContain('预计提醒时间')
  act(() => { vi.advanceTimersByTime(60000) })
  expect(card.textContent).toContain('计划已结束')
  expect(card.textContent).not.toContain('周期进行中')
  expect(card.textContent).not.toContain('16:05:00')
})

it('uses concise localized errors for scheduler failures', () => {
  const message = 'Resumed execution would reach or exceed the schedule end time'
  expect(schedulerError(message, t)).toBe('恢复后将超过结束时间，请新建任务。')
  expect(schedulerError(message, key => en[key])).toBe(en.resumePastEnd)
  expect(schedulerError('Network failed internally', t)).toBe('操作失败，请刷新后重试。')
  expect(schedulerError('请选择未来时间。', t)).toBe('请选择未来时间。')
  expect(zh.timingMissing).toBe('请填写提醒时间。')
})

it.each([
  ['每天17:00提醒我吃饭', 86400, '2026-09-16T09:00:00.000Z', undefined],
  ['每周五下午三点提醒我开会', 604800, '2026-09-18T07:00:00.000Z', undefined],
  ['每5分钟提醒我喝水，直到今天18:00', 300, undefined, '2026-09-16T10:00:00.000Z'],
])('submits the recognized clock and cutoff without an extra period: %s', async (prompt, interval, at, endAt) => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-09-16T16:00:00+08:00'))
  const state = { owners: [{ id: 'owner', title: 'Test', workspace: '/test' }], owner: 'owner',
    data: { tasks: [], runs: [], minEverySeconds: 300 }, busy: false, error: null, notice: null }
  const create = vi.fn<(input: CreateTaskRequest) => Promise<boolean>>().mockResolvedValue(true)
  const props = { useSnapshot: (select: (value: typeof state) => unknown) => select(state), refresh: vi.fn(),
    prepareSession: vi.fn().mockResolvedValue(undefined), t, change: vi.fn(), select: vi.fn(), create,
    deleteRun: vi.fn(),
    close: vi.fn(), viewSession: vi.fn() } as unknown as PanelProps
  const view = render(<SchedulerPanel {...props} creationOnly />)
  fireEvent.click(view.getByText('定时任务', { selector: 'button' }))
  fireEvent.change(view.container.querySelector('textarea')!, { target: { value: prompt } })
  await act(async () => { fireEvent.submit(view.container.querySelector('form')!) })
  expect(create).toHaveBeenCalledOnce()
  const request = create.mock.calls[0]![0]
  expect(request.everySeconds).toBe(interval)
  expect(request.endAt).toBe(endAt)
  if (at) { expect(request.at).toBe(at); expect(request.delaySeconds).toBeUndefined() }
  else expect(request.delaySeconds).toBe(interval)
})
