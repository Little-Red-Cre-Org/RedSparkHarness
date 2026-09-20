import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TaskStore } from '../src/store.ts'
import { createNoticeController } from '../src/client/notices.ts'
import type { TaskNotice } from '../src/gui-types.ts'

afterEach(() => { vi.useRealTimers() })
it('migrates v1 without losing tasks and persists acknowledgement separately from result delivery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-notices-'))
  const path = join(dir, 'tasks.sqlite')
  let store: TaskStore | undefined
  try {
    const old = new DatabaseSync(path)
    old.exec('PRAGMA user_version=1; CREATE TABLE tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE runs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(task_id,scheduled_at));')
    old.close()
    store = new TaskStore(path)
    store.create('closed-owner', { title: 'Lunch', prompt: 'Time for lunch', workspace: process.cwd(), agentPreset: 'standard', permissionPreset: 'read-only', provider: 'mock', model: 'mock', at: new Date(2000).toISOString() }, 1000, 300)
    expect(store.notices(1000)).toEqual([])
    const queued = store.notices(2000)[0]!
    expect(queued).toMatchObject({ phase: 'due', read: false, sessionId: null })
    const claim = store.claim(2000, 10000, 1)!
    const due = store.notices()[0]!
    expect(due.id).toBe(queued.id)
    expect(due).toMatchObject({ phase: 'due', body: 'Time for lunch', read: false })
    store.acknowledge(due.id)
    store.close(); store = new TaskStore(path)
    expect(store.notices()[0]!.read).toBe(true)
    store.settle({ ...claim.run, state: 'failed', detail: 'Provider unavailable' }, 3000, 10)
    expect(store.notices()[0]!.time).toBe(3000)
    expect(store.notices()).toEqual([expect.objectContaining({ id: due.id, phase: 'failed', read: true, body: 'Time for lunch' })])
    expect(() =>{  store!.acknowledge('unknown') }).toThrow('no longer exists')
    expect(store.tasks()).toHaveLength(1)
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }) }
})

const notice: TaskNotice = { id: 'run:due', title: 'Lunch', body: 'Time for lunch', phase: 'due', time: 1, sessionId: null, read: false }
it.each(['completed', 'failed', 'blocked', 'interrupted'] as const)('uses persisted settlement time for %s reminders without changing their identity', (state) => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-result-time-'))
  const path = join(dir, 'tasks.sqlite')
  let store = new TaskStore(path)
  try {
    store.create('owner', { title: 'Time check', prompt: 'Check time', workspace: process.cwd(), agentPreset: 'standard', permissionPreset: 'read-only', provider: 'mock', model: 'mock', at: new Date(2000).toISOString() }, 1000, 300)
    const queued = store.notices(2000)[0]!
    const claim = store.claim(2500, 10000, 1)!
    expect(store.notices(2500)[0]).toMatchObject({ id: queued.id, time: 2500, phase: 'due' })
    store.settle({ ...claim.run, state, detail: '' }, 7777, 10)
    store.close()
    store = new TaskStore(path)
    expect(store.notices(8000)[0]).toMatchObject({ id: queued.id, time: 7777, phase: state })
    expect(store.runs()[0]).toMatchObject({ scheduledAt: 2000, startedAt: 2500, finishedAt: 7777 })
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('withdraws desktop delivery and closes the inbox when the source record disappears', async () => {
  let items: TaskNotice[] = [{ ...notice, phase: 'completed' }]
  const dismiss = vi.fn()
  const controller = createNoticeController({ list: async () => items, acknowledge: async () => [], remove: async () => [],
    notify: vi.fn(), dismiss })
  await controller.refresh()
  items = []
  await controller.refresh()
  expect(dismiss).toHaveBeenCalledWith(notice.id)
  expect(controller.store.getSnapshot()).toMatchObject({ items: [], open: false })
  controller.dispose()
})
it('delivers both completed occurrences of a recurring plan once each', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-recurring-delivery-'))
  const store = new TaskStore(join(dir, 'tasks.sqlite'))
  let now = 2000
  const notify = vi.fn()
  const controller = createNoticeController({ list: async () => store.notices(now, true),
    acknowledge: async () => [], remove: async () => [],
    notify: (item) => { if (item.phase !== 'due') notify(item) },
  })
  try {
    store.create('owner', { title: 'Drink water', prompt: 'Reminder', workspace: process.cwd(), agentPreset: 'standard',
      permissionPreset: 'read-only', provider: 'mock', model: 'mock', at: new Date(now).toISOString(), everySeconds: 300 }, 1000, 300)
    for (const at of [2000, 302000]) {
      now = at
      const claim = store.claim(now, 10000, 1)!
      await controller.refresh()
      store.settle({ ...claim.run, state: 'completed' }, now + 100, 10)
      now += 100
      await controller.refresh()
      await controller.refresh()
    }
    expect(notify).toHaveBeenCalledTimes(2)
    expect(new Set(notify.mock.calls.map(call => (call[0] as TaskNotice).id)).size).toBe(2)
    expect(store.tasks()[0]!.nextAt).toBe(602000)
  } finally { controller.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('delivers completion after inbox deletion without restoring the deleted card', async () => {
  let items: TaskNotice[] = [{ ...notice, dismissed: true }]
  const notify = vi.fn()
  const controller = createNoticeController({ list: async () => items, remove: async () => items, acknowledge: async () => items, notify })
  await controller.refresh()
  expect(notify).not.toHaveBeenCalled()
  items = [{ ...notice, dismissed: true, phase: 'completed' }]
  await controller.refresh()
  await controller.refresh()
  expect(notify).toHaveBeenCalledOnce()
  expect(controller.store.getSnapshot()).toMatchObject({ items: [], open: false })
  controller.dispose()
})
it('updates one read card to its outcome, notifies once and does not reopen the dismissed dialog', async () => {
  let items = [notice]
  const notify = vi.fn()
  const controller = createNoticeController({ remove: async () => [], list: async () => items, acknowledge: async () => items, notify })
  await controller.refresh()
  controller.close()
  items = [{ ...notice, phase: 'completed', read: true }]
  await controller.refresh()
  await controller.refresh()
  expect(controller.store.getSnapshot()).toMatchObject({ open: false, items })
  expect(controller.store.getSnapshot().items).toHaveLength(1)
  expect(notify).toHaveBeenCalledTimes(2)
  expect(notify.mock.calls[1]![0]).toMatchObject({ phase: 'completed' })
  controller.dispose()
})
it('delivers without Settings, does not repeatedly reopen dismissed notices, and cancels polling on unload', async () => {
  vi.useFakeTimers()
  let items = [notice]
  const notify = vi.fn(), list = vi.fn(async () => items)
  const controller = createNoticeController({ remove: async () => [], list, notify,
    acknowledge: async () => { items = [{ ...notice, read: true }]; return items } })
  controller.start()
  await vi.advanceTimersByTimeAsync(1)
  expect(controller.store.getSnapshot().open).toBe(true)
  controller.close()
  await vi.advanceTimersByTimeAsync(6000)
  expect(notify).toHaveBeenCalledTimes(1)
  expect(controller.store.getSnapshot().open).toBe(false)
  await controller.acknowledge(notice.id)
  expect(controller.store.getSnapshot().items[0]!.read).toBe(true)
  controller.dispose()
  const calls = list.mock.calls.length
  await vi.advanceTimersByTimeAsync(6000)
  expect(list).toHaveBeenCalledTimes(calls)
})
it('keeps in-app delivery when native notifications fail and does not publish a late response', async () => {
  const controller = createNoticeController({ remove: async () => [], list: async () => [notice], acknowledge: async () => { throw Error('offline') }, notify: () => { throw Error('denied') } })
  await controller.refresh()
  expect(controller.store.getSnapshot().open).toBe(true)
  await controller.acknowledge(notice.id)
  expect(controller.store.getSnapshot()).toMatchObject({ error: 'offline', items: [notice] })
  controller.dispose()
  let resolve!: (items: TaskNotice[]) => void
  const late = createNoticeController({ remove: async () => [], list: () => new Promise((r) => { resolve = r }),
    acknowledge: async () => [], notify: vi.fn() })
  const pending = late.refresh()
  late.dispose(); resolve([notice]); await pending
  expect(late.store.getSnapshot().items).toEqual([])
})

it('keeps deleted reminders removed across restart and settlement without cancelling recurring work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-delete-'))
  const path = join(dir, 'tasks.sqlite')
  let store = new TaskStore(path)
  try {
    store.create('owner', { title: 'Repeat', prompt: 'Reminder', workspace: process.cwd(), agentPreset: 'standard', permissionPreset: 'read-only', provider: 'mock', model: 'mock', at: new Date(2000).toISOString(), everySeconds: 300 }, 1000, 300)
    const claim = store.claim(2000, 10000, 1)!
    const id = store.notices(2000)[0]!.id
    store.deleteNotice(id)
    store.close(); store = new TaskStore(path)
    expect(store.notices(2000)).toEqual([])
    store.settle({ ...claim.run, state: 'completed' }, 3000, 10)
    expect(store.notices(3000)).toEqual([])
    expect(store.notices(3000, true)).toEqual([expect.objectContaining({ dismissed: true, phase: 'completed' })])
    expect(store.tasks()[0]!.state).toBe('active')
    expect(store.runs()).toHaveLength(1)
    expect(store.notices(302000)).toHaveLength(1)
    expect(() =>{  store.deleteNotice('unknown') }).toThrow('no longer exists')
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('deletes only finished owned records durably while preserving plans and other receipts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-records-'))
  const path = join(dir, 'tasks.sqlite')
  let store = new TaskStore(path)
  try {
    store.create('owner', { title: 'Keep plan', prompt: 'Check', workspace: process.cwd(), agentPreset: 'standard', permissionPreset: 'read-only', provider: 'mock', model: 'mock', at: new Date(2000).toISOString() }, 1000, 300)
    const claim = store.claim(2000, 10000, 1)!
    expect(() =>{  store.deleteRun('owner', claim.run.id) }).toThrow('Running records')
    store.settle({ ...claim.run, state: 'completed', sessionId: 'kept-session' }, 3000, 10)
    expect(() =>{  store.deleteRun('other-owner', claim.run.id) }).toThrow('not found')
    store.deleteRun('owner', claim.run.id)
    store.close(); store = new TaskStore(path)
    expect(store.runs()).toEqual([])
    expect(store.notices(3000)).toEqual([])
    expect(store.tasks()).toHaveLength(1)
    expect(store.claim(4000, 10000, 1)).toBeUndefined()
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('groups recurring reminders while delivering each new occurrence and retaining acknowledgement boundaries', async () => {
  let items: TaskNotice[] = [
    { ...notice, id: 'one', taskId: 'water', recurring: true, phase: 'completed', time: 1 },
    { ...notice, id: 'two', taskId: 'water', recurring: true, phase: 'completed', time: 2 },
  ]
  const notify = vi.fn()
  const controller = createNoticeController({ list: async () => items, notify,
    acknowledge: async () => items, remove: async () => items })
  await controller.refresh()
  expect(controller.store.getSnapshot().items).toEqual([expect.objectContaining({ id: 'two', occurrenceCount: 2 })])
  items = [...items, { ...notice, id: 'three', taskId: 'water', recurring: true, phase: 'completed', time: 3 }]
  await controller.refresh()
  expect(controller.store.getSnapshot().items).toEqual([expect.objectContaining({ id: 'three', occurrenceCount: 3 })])
  expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'three' }), expect.any(Function))
  items = items.map(item => item.id === 'three' ? { ...item, dismissed: true } : item)
  await controller.refresh()
  expect(controller.store.getSnapshot().items).toEqual([])
  controller.dispose()
})
