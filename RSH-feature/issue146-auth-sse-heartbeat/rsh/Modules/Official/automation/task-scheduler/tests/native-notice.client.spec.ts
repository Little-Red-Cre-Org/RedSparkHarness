import { expect, it } from 'vitest'
import { nativeNoticeContent } from '../src/client/native-notice.ts'
import { zh } from '../src/client/locales.ts'
import type { TaskNotice } from '../src/gui-types.ts'

const item: TaskNotice = { id: 'run:result', title: '检查项目测试', body: 'internal detail', time: 1, phase: 'completed', sessionId: null, read: false }
it('labels a recurring occurrence separately from completion of the whole plan', () => {
  const banner = nativeNoticeContent({ ...item, recurring: true, nextAt: 300001, planState: 'active' }, key => zh[key])
  expect(banner.title).toBe('检查项目测试 · 本次执行完成')
  expect(banner.title).not.toContain('已完成')
})
it('shows the task name and completed status in the native banner', () => {
  expect(nativeNoticeContent(item, key => zh[key])).toEqual({ title: '检查项目测试 · 已完成',
    body: '任务：检查项目测试\n状态：已完成\n点击通知查看执行结果。' })
})
it('never labels failed, blocked or interrupted runs completed', () => {
  for (const phase of ['failed', 'blocked', 'interrupted'] as const) {
    const banner = nativeNoticeContent({ ...item, phase }, key => zh[key])
    expect(banner.body).toContain(`状态：${zh[`state.${phase}`]}`)
    expect(banner.title).not.toContain('已完成')
  }
})

it('distinguishes waiting and running work from a clock notification', () => {
  expect(nativeNoticeContent({ ...item, phase: 'due', sessionId: null }, key => zh[key]).title).toBe('检查项目测试 · 等待执行')
  expect(nativeNoticeContent({ ...item, phase: 'due', sessionId: 'execution' }, key => zh[key]).title).toBe('检查项目测试 · 执行中')
  expect(nativeNoticeContent({ ...item, directReminder: true }, key => zh[key]).title).toContain('已提醒')
})
