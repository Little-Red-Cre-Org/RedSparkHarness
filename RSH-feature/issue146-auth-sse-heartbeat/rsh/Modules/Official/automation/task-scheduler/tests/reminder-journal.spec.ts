import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { appendReminderRecords } from '../src/reminder-journal.ts'
import type { Task, Run } from '../src/types.ts'

it('keeps all occurrences in a single conversation and does not duplicate them after replay', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  try {
    const session = ctx.sessions.create(SessionId('water-journal'))
    const task = { id: brandString<Task['id']>('water'), title: '喝水', prompt: '每五分钟提醒我喝水' } as Task
    const runs = [0, 1, 2].map(i => ({ id: brandString<Run['id']>(`run-${i}`), taskId: task.id,
      scheduledAt: 1789527225000 + i * 300000, startedAt: 1789527225000 + i * 300000,
      finishedAt: 1789527225000 + i * 300000, deadline: 1789527226000 + i * 300000,
      state: 'completed' as const, sessionId: null, detail: 'Reminder dispatched' }))
    appendReminderRecords(session, task, runs.slice(0, 2))
    appendReminderRecords(session, task, runs)
    appendReminderRecords(session, task, runs)
    const messages = session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(messages).toHaveLength(3)
    expect(messages.map(event => event.data.source)).toEqual([
      expect.objectContaining({ kind: 'plugin', summary: '2026/9/16 10:53:45 · 喝水 · 已提醒' }),
      expect.objectContaining({ kind: 'plugin', summary: '2026/9/16 10:58:45 · 喝水 · 已提醒' }),
      expect.objectContaining({ kind: 'plugin', summary: '2026/9/16 11:03:45 · 喝水 · 已提醒' }),
    ])
    expect(session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
