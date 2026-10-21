import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskStore } from '../src/store.ts'
import { reminderStartTime } from '../src/history.ts'
import type { TaskInput } from '../src/types.ts'

const now = Date.parse('2026-09-15T00:00:00Z')
const input: TaskInput = { title: 'Check tests', prompt: 'Run tests and report facts', workspace: process.cwd(),
  agentPreset: 'standard', permissionPreset: 'read-only', provider: 'test', model: 'test', at: new Date(now + 1000).toISOString() }
const resources: { dir: string; stores: TaskStore[] }[] = []
function open() {
  const dir = mkdtempSync(join(tmpdir(), 'task-scheduler-'))
  const path = join(dir, 'tasks.sqlite')
  const store = new TaskStore(path)
  resources.push({ dir, stores: [store] })
  return { store, path, resource: resources.at(-1)! }
}
afterEach(() => { vi.useRealTimers(); for (const { dir, stores } of resources.splice(0)) {
  for (const store of stores) store.close()
  rmSync(dir, { recursive: true, force: true })
} })

describe('durable scheduled tasks', () => {
  it.each([undefined, 300])('freezes the remaining wait across restart and repeated pause/resume (period %s)', (everySeconds) => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { store, path, resource } = open()
    const task = store.create('owner', { ...input, everySeconds, at: new Date(now + 300000).toISOString() }, now, 300)
    vi.setSystemTime(now + 120000)
    expect(store.change('owner', task.id, 'paused').pausedRemainingMs).toBe(180000)
    vi.setSystemTime(now + 600000)
    expect(store.change('owner', task.id, 'paused').pausedRemainingMs).toBe(180000)
    expect(store.claim(now + 600000, 10000, 1)).toBeUndefined()
    store.close(); resource.stores.length = 0
    const reopened = new TaskStore(path); resource.stores.push(reopened)
    vi.setSystemTime(now + 720000)
    expect(reopened.change('owner', task.id, 'active').nextAt).toBe(now + 900000)
    vi.setSystemTime(now + 780000)
    expect(reopened.change('owner', task.id, 'active').nextAt).toBe(now + 900000)
    expect(reopened.claim(now + 899999, 10000, 1)).toBeUndefined()
    const first = reopened.claim(now + 900000, 10000, 1)!
    expect(first.run.scheduledAt).toBe(now + 900000)
    reopened.settle({ ...first.run, state: 'completed' }, now + 900001, 50)
    expect(reopened.claim(now + 1199999, 10000, 1)).toBeUndefined()
    expect(reopened.claim(now + 1200000, 10000, 1)?.run.scheduledAt).toBe(everySeconds ? now + 1200000 : undefined)
  })
  it('does not move the deadline or resume beyond it', () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { store } = open()
    const endAt = new Date(now + 600000).toISOString()
    const task = store.create('owner', { ...input, at: new Date(now + 300000).toISOString(), everySeconds: 300, endAt }, now, 300)
    vi.setSystemTime(now + 120000); store.change('owner', task.id, 'paused')
    vi.setSystemTime(now + 420000)
    expect(() => store.change('owner', task.id, 'active')).toThrow('end time')
    expect(store.tasks()[0]).toMatchObject({ state: 'paused', pausedRemainingMs: 180000, endAt })
    vi.setSystemTime(now + 600000)
    expect(() => store.change('owner', task.id, 'active')).toThrow('ended')
    expect(store.claim(now + 600000, 10000, 1)).toBeUndefined()
  })
  it('retains countdown history after task deletion and database reopen', () => {
    const { store, path, resource } = open()
    const task = store.create('owner', { ...input, prompt: '五分钟后提醒我吃饭',
      at: new Date(now + 300000).toISOString(), countdownStartedAt: new Date(now).toISOString() }, now, 300)
    const claim = store.claim(now + 300050, 10000, 1)!
    store.settle({ ...claim.run, state: 'completed', detail: 'Reminder dispatched', sessionId: null }, now + 300060, 50)
    store.change('owner', task.id, 'deleted')
    store.close()
    resource.stores.length = 0
    const reopened = new TaskStore(path)
    resource.stores.push(reopened)
    const receipt = reopened.runs()[0]!
    const deleted = reopened.tasks().find(item => item.id === receipt.taskId)!
    expect(deleted.state).toBe('deleted')
    expect(reminderStartTime(receipt, deleted)).toBe(now)
    expect(reminderStartTime({ ...receipt, scheduledAt: now + 900000 }, { ...deleted, everySeconds: 300 })).toBe(now + 600000)
    expect(reminderStartTime(receipt, { ...deleted, countdownStartedAt: undefined })).toBe(receipt.startedAt)
    expect(reminderStartTime(receipt, undefined)).toBeNull()
  })
  it('does not admit a two-minute reminder even one millisecond before its target', () => {
    const { store } = open()
    const created = now + 45934
    store.create('owner', { ...input, at: new Date(created + 120000).toISOString() }, created, 300)
    expect(store.claim(created + 60000, 10000, 1)).toBeUndefined()
    expect(store.claim(created + 119999, 10000, 1)).toBeUndefined()
    expect(store.claim(created + 120000, 10000, 1)?.run.startedAt).toBe(created + 120000)
  })
  it('requires acceptance criteria, forbids timed goal repetition and resumes one persisted execution', () => {
    const { store, path, resource } = open()
    expect(() => store.create('owner', { ...input, kind: 'goal' }, now, 300)).toThrow('completion criteria')
    expect(() => store.create('owner', { ...input, kind: 'goal', completionCriteria: 'Tests pass', everySeconds: 300 }, now, 300)).toThrow('cannot repeat')
    const task = store.create('owner', { ...input, kind: 'goal', completionCriteria: 'Tests pass' }, now, 300)
    const first = store.claim(now + 1000, 10000, 1)!
    expect(() => store.change('owner', task.id, 'active')).toThrow('unfinished')
    store.progress(first.run.id, 'Checked files; verification remains')
    store.settle({ ...first.run, state: 'blocked' }, now + 2000, 50)
    const second = new TaskStore(path); resource.stores.push(second)
    expect(second.claim(Date.now(), 10000, 1)).toBeUndefined()
    expect(() => second.change('other', task.id, 'active')).toThrow('not found')
    second.change('owner', task.id, 'active')
    const resumed = second.claim(Date.now() + 1, 10000, 1)!
    expect(resumed.task.resumeSessionId).toBe(first.run.sessionId)
    expect(resumed.run.sessionId).toBe(first.run.sessionId)
    store.settle({ ...resumed.run, state: 'completed' }, Date.now() + 2, 50)
    expect(() => store.change('owner', task.id, 'active')).toThrow('unfinished')
  })
  it('persists plans across reopen and claims a one-shot only once across two connections', () => {
    const { store, path, resource } = open()
    const task = store.create('owner', input, now, 300)
    const second = new TaskStore(path); resource.stores.push(second)
    expect(second.tasks()).toEqual([task])
    expect(second.claim(now, 10000, 1)).toBeUndefined()
    expect(store.claim(now + 1000, 10000, 1)?.task.id).toBe(task.id)
    expect(second.claim(now + 1000, 10000, 1)).toBeUndefined()
  })
  it('coalesces overdue periods, blocks overlapping runs, and preserves anchor alignment', () => {
    const { store } = open()
    store.create('owner', { ...input, everySeconds: 300 }, now, 300)
    const claim = store.claim(now + 901000, 10000, 2)!
    expect(claim.run.scheduledAt).toBe(now + 901000)
    expect(claim.task.nextAt).toBe(now + 1201000)
    expect(store.claim(now + 1501000, 10000, 2)).toBeUndefined()
    store.settle({ ...claim.run, state: 'completed' }, now + 901100, 50)
    expect(store.claim(now + 1501000, 10000, 2)?.run.scheduledAt).toBe(now + 1501000)
  })
  it('isolates management by owner and preserves paused state across restart', () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { store, path, resource } = open()
    const task = store.create('owner', input, now, 300)
    expect(() => store.change('other', task.id, 'deleted')).toThrow('not found')
    store.change('owner', task.id, 'paused')
    const second = new TaskStore(path); resource.stores.push(second)
    expect(second.claim(now + 1000, 10000, 1)).toBeUndefined()
    second.change('owner', task.id, 'active')
    expect(second.claim(now + 1000, 10000, 1)).toBeDefined()
    expect(() => store.change('owner', task.id, 'active')).toThrow('finished')
  })
  it('deletes future work without falsifying the result of an active run', () => {
    const { store } = open()
    const task = store.create('owner', { ...input, everySeconds: 300 }, now, 300)
    const claim = store.claim(now + 1000, 10000, 1)!
    store.change('owner', task.id, 'deleted')
    store.settle({ ...claim.run, state: 'failed', detail: 'model unavailable' }, now + 2000, 50)
    expect(store.runs()[0]?.state).toBe('failed')
    expect(store.claim(now + 999000, 10000, 1)).toBeUndefined()
  })
  it('marks an expired execution uncertain without replaying its one-shot occurrence', () => {
    const { store } = open()
    store.create('owner', input, now, 300)
    store.claim(now + 1000, 10000, 1)
    store.recoverExpired(now + 11000)
    expect(store.runs()[0]?.state).toBe('interrupted')
    expect(store.tasks()[0]?.state).toBe('paused')
    expect(store.claim(now + 12000, 10000, 1)).toBeUndefined()
  })
  it('ends recurring admission exclusively at the cutoff without cancelling an existing run', () => {
    const { store } = open()
    const endAt = new Date(now + 301000).toISOString()
    store.create('owner', { ...input, everySeconds: 300, endAt }, now, 300)
    const run = store.claim(now + 1000, 900000, 1)!.run
    expect(store.tasks()[0]?.nextAt).toBeNull()
    expect(store.claim(now + 301000, 900000, 1)).toBeUndefined()
    expect(store.runs()[0]?.state).toBe('running')
    store.settle({ ...run, state: 'completed' }, now + 401000, 50)
    expect(store.runs()[0]?.state).toBe('completed')
  })
  it('does not catch up expired plans after restart or emit a queued due reminder', () => {
    const { store, path, resource } = open()
    store.create('owner', { ...input, endAt: new Date(now + 2000).toISOString() }, now, 300)
    const restored = new TaskStore(path); resource.stores.push(restored)
    expect(restored.notices(now + 2000)).toEqual([])
    expect(restored.claim(now + 2000, 10000, 1)).toBeUndefined()
    expect(restored.tasks()[0]?.nextAt).toBeNull()
    expect(restored.runs()).toEqual([])
  })
  it('rejects end times before or equal to start, including timezone-equivalent instants', () => {
    const { store } = open()
    for (const endAt of [input.at, new Date(now).toISOString(), '2026-09-15T08:00:01+08:00', '2026-09-15T10:00:00']) {
      expect(() => store.create('owner', { ...input, endAt }, now, 300)).toThrow()
    }
    expect(store.tasks()).toEqual([])
  })
  it('rejects ambiguous dates, past dates, short periods and invalid paths', () => {
    const { store } = open()
    for (const overrides of [{ at: '2026-09-16T00:00:00' }, { at: new Date(now).toISOString() },
      { everySeconds: 2 }, { workspace: 'relative' }, { prompt: ' ' }]) {
      expect(() => store.create('owner', { ...input, ...overrides }, now, 300)).toThrow()
    }
    expect(store.tasks()).toEqual([])
  })
  it('bounds finished history without deleting the latest failed result', () => {
    const { store } = open()
    store.create('owner', { ...input, everySeconds: 300 }, now, 300)
    for (let i = 0; i < 4; i++) {
      const time = now + 1000 + i * 300000
      const claim = store.claim(time, 10000, 1)!
      store.settle({ ...claim.run, state: 'failed' }, time + 1, 2)
    }
    expect(store.runs()).toHaveLength(2)
    expect(store.runs()[0]?.scheduledAt).toBe(now + 901000)
  })
})
