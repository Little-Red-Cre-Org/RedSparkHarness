import { expect, it, vi } from 'vitest'
import { Context } from '@redspark/cordis'
import SessionStore, { SessionId } from '@redspark/rsh-session'
import { brandString } from '@redspark/rsh-brand'
import { appendReminderRecords, startReminderJournal } from '../src/reminder-journal.ts'
import type { TaskStore } from '../src/store.ts'
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

it('publishes the journal identity only after its writer closes', async () => {
  const order: string[] = []
  const task = { id: brandString<Task['id']>('water'), ownerSessionId: 'owner', title: '喝水',
    prompt: '每五分钟提醒我喝水', workspace: '/tmp', agentPreset: 'test', provider: 'mock', model: 'mock',
    at: new Date(0).toISOString(), state: 'active' as const, everySeconds: 300, nextAt: null } as Task
  const run = { id: brandString<Run['id']>('run'), taskId: task.id, scheduledAt: 0, startedAt: 0, deadline: 1,
    finishedAt: 1, state: 'completed' as const, sessionId: null, detail: 'Reminder dispatched' }
  const session = { deriveMessages: () => [], append: () => {} }
  const fake = {
    workspaceRegistry: { archivedSessionIds: [], create: async () => ({ attachSession: async () => {} }) },
    agents: { get: () => undefined, create: async () => ({ agent: { session },
      dispose: async () => { order.push('dispose') } }) },
    agentPresets: { resolve: async () => ({ id: 'test' }), mount: async () => {} },
    sessionTitle: { rename: () => {} },
    sessions: { flush: async () => { order.push('flush') } },
    logger: { error: () => {} },
  } as unknown as Context
  const store = { tasks: () => [task], runs: () => [run],
    bindReminderSession: () => { order.push('bind') } } as unknown as TaskStore
  const stop = startReminderJournal(fake, store)
  try {
    await vi.waitFor(() => { expect(order).toContain('bind') })
  } finally { await stop() }
  expect(order).toEqual(['flush', 'dispose', 'bind'])
})
