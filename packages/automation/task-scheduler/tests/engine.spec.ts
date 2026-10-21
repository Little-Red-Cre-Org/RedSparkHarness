import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskStore } from '../src/store.ts'
import { SchedulerEngine } from '../src/engine.ts'
import type { ExecuteTask, SchedulerOptions } from '../src/types.ts'

const options: SchedulerOptions = { pollMs: 100, runTimeoutMs: 1000, maxConcurrent: 1, historyLimit: 10, minEverySeconds: 300 }
const owned: { dir: string; engine: SchedulerEngine }[] = []
function harness(execute: ExecuteTask) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
  const dir = mkdtempSync(join(tmpdir(), 'task-engine-'))
  const store = new TaskStore(join(dir, 'tasks.sqlite'))
  const error = vi.fn()
  const engine = new SchedulerEngine(store, execute, options, error)
  owned.push({ dir, engine })
  const create = () => store.create('owner', { title: 'test', prompt: 'check', workspace: process.cwd(),
    agentPreset: 'standard', permissionPreset: 'read-only', provider: 'test', model: 'test',
    at: new Date(Date.now() + 100).toISOString() }, Date.now(), 300)
  return { store, engine, create, error }
}
afterEach(async () => {
  for (const { dir, engine } of owned.splice(0)) { await engine.dispose(); rmSync(dir, { recursive: true, force: true }) }
  vi.useRealTimers()
})
describe('scheduler runtime', () => {
  it('dispatches reminders every five minutes while an Agent occupies the only slot, stopping at the end', async () => {
    const execute = vi.fn<ExecuteTask>(async (_task, _run, signal) => {
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return { state: 'blocked', sessionId: 'busy-agent', detail: 'stopped' }
    })
    const { store, engine, create, error } = harness(execute)
    options.runTimeoutMs = 2000000
    const start = Date.now()
    create()
    const reminder = store.create('owner', { title: '喝水', prompt: '每五分钟提醒我喝水', kind: 'scheduled', workspace: process.cwd(),
      agentPreset: 'standard', permissionPreset: 'read-only', provider: 'test', model: 'test',
      at: new Date(start + 300000).toISOString(), everySeconds: 300, endAt: new Date(start + 900001).toISOString() }, start, 300)
    try {
      engine.start()
      await vi.advanceTimersByTimeAsync(299999)
      expect(store.runs().filter(run => run.taskId === reminder.id)).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(600001)
      const runs = store.runs().filter(run => run.taskId === reminder.id).sort((a, b) => a.scheduledAt - b.scheduledAt)
      expect(runs.map(run => run.startedAt - start)).toEqual([300000, 600000, 900000])
      expect(runs.every(run => run.finishedAt === run.startedAt && run.sessionId === null && run.state === 'completed')).toBe(true)
      await vi.advanceTimersByTimeAsync(300000)
      expect(store.runs().filter(run => run.taskId === reminder.id)).toHaveLength(3)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(error).not.toHaveBeenCalled()
    } finally { options.runTimeoutMs = 1000 }
  })
  it('executes three full periods without early starts, then stops after deletion', async () => {
    const execute = vi.fn<ExecuteTask>().mockResolvedValue({ state: 'completed', sessionId: 'test-execution', detail: 'done' })
    const { store, engine, error } = harness(execute)
    const start = Date.now() + 100
    const task = store.create('owner', { title: 'Recurring test', prompt: 'Check', workspace: process.cwd(),
      agentPreset: 'standard', permissionPreset: 'read-only', provider: 'test', model: 'test',
      at: new Date(start).toISOString(), everySeconds: 300 }, Date.now(), 300)
    engine.start()
    await vi.advanceTimersByTimeAsync(99)
    expect(execute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(execute).toHaveBeenCalledTimes(1)
    for (const count of [2, 3]) {
      await vi.advanceTimersByTimeAsync(299999)
      expect(execute).toHaveBeenCalledTimes(count - 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(execute).toHaveBeenCalledTimes(count)
    }
    expect(store.runs().map(run => run.scheduledAt).sort()).toEqual([start, start + 300000, start + 600000])
    expect(store.runs().every(run => run.state === 'completed' && run.startedAt >= run.scheduledAt)).toBe(true)
    expect(store.tasks()[0]?.nextAt).toBe(start + 900000)
    expect(store.notices().filter(item => item.phase === 'completed')).toHaveLength(3)
    store.change('owner', task.id, 'deleted')
    await vi.advanceTimersByTimeAsync(600000)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(error).not.toHaveBeenCalled()
  })
  it('records actual settlement and does not call an enqueued run completed', async () => {
    let complete!: () => void
    const { store, engine, create } = harness(async () => {
      await new Promise<void>((resolve) => { complete = resolve })
      return { state: 'completed', sessionId: 'execution', detail: 'turn ended' }
    })
    create(); engine.start(); await vi.advanceTimersByTimeAsync(100)
    expect(store.runs()[0]?.state).toBe('running')
    complete(); await vi.advanceTimersByTimeAsync(1)
    expect(store.runs()[0]).toMatchObject({ state: 'completed', sessionId: 'execution' })
  })
  it('reports execution errors and keeps polling for other tasks', async () => {
    const execute = vi.fn<ExecuteTask>().mockRejectedValueOnce(new Error('provider offline'))
      .mockResolvedValue({ state: 'blocked', sessionId: 'second', detail: 'permission required' })
    const { store, engine, create } = harness(execute)
    create(); create(); engine.start(); await vi.advanceTimersByTimeAsync(300)
    expect(store.runs().map(run => run.state)).toEqual(['blocked', 'failed'])
    expect(execute).toHaveBeenCalledTimes(2)
  })
  it('aborts an overlong execution and never records success after its deadline', async () => {
    const { store, engine, create } = harness(async (_task, _run, signal) => {
      await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
      return { state: 'completed', sessionId: 'late', detail: 'late completion' }
    })
    create(); engine.start(); await vi.advanceTimersByTimeAsync(1200)
    expect(store.runs()[0]?.state).toBe('interrupted')
  })
  it('unloading drains cancellation and leaves future plans persisted', async () => {
    const { engine, create } = harness(async (_task, _run, signal) => {
      await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('execution aborted')) }, { once: true }) })
      throw new Error('unreachable')
    })
    create(); const pending = create(); engine.start(); await vi.advanceTimersByTimeAsync(100)
    const item = owned.pop()!
    await engine.dispose()
    const restored = new TaskStore(join(item.dir, 'tasks.sqlite'))
    try {
      expect(restored.runs()[0]?.state).toBe('interrupted')
      expect(restored.tasks().find(task => task.id === pending.id)?.nextAt).not.toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    } finally { restored.close(); rmSync(item.dir, { recursive: true, force: true }) }
  })
})
