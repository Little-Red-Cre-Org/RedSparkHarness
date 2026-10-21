import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { TaskStore } from '../src/store.ts'
import { SchedulerEngine } from '../src/engine.ts'

it.skipIf(process.env['SCHEDULER_REALTIME_AUDIT'] !== '1')('measures a real five-minute reminder interval without a model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-realtime-'))
  const store = new TaskStore(join(dir, 'test.sqlite'))
  let modelCalls = 0
  const errors: string[] = []
  const engine = new SchedulerEngine(store, async () => { modelCalls++; throw new Error('Unexpected model invocation') },
    { pollMs: 100, runTimeoutMs: 1000, maxConcurrent: 1, historyLimit: 50, minEverySeconds: 300 },
    (error) => { errors.push(String(error)) })
  const first = Date.now() + 1000
  store.create('audit-owner', { title: 'Isolated timer audit', prompt: '每5分钟提醒我喝水', kind: 'scheduled',
    workspace: process.cwd(), provider: 'unused', model: 'unused', agentPreset: 'unused', permissionPreset: 'unused',
    at: new Date(first).toISOString(), everySeconds: 300, endAt: new Date(first + 300500).toISOString() }, Date.now(), 300)
  try {
    engine.start()
    const until = first + 302000
    while (Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100))
    const runs = store.runs().sort((a, b) => a.scheduledAt - b.scheduledAt)
    const report = { checkedAt: new Date().toISOString(), modelCalls, errors,
      runs: runs.map(run => ({ scheduledAt: run.scheduledAt, actualAt: run.startedAt, delayMs: run.startedAt - run.scheduledAt })),
      actualIntervalMs: runs.length === 2 ? runs[1]!.startedAt - runs[0]!.startedAt : null }
    if (process.env['SCHEDULER_REALTIME_REPORT']) writeFileSync(process.env['SCHEDULER_REALTIME_REPORT'], JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    expect(runs).toHaveLength(2)
    expect(runs[1]!.scheduledAt - runs[0]!.scheduledAt).toBe(300000)
    expect(runs.every(run => run.startedAt >= run.scheduledAt && run.startedAt - run.scheduledAt < 2000)).toBe(true)
    expect(modelCalls).toBe(0)
    expect(errors).toEqual([])
    expect(store.tasks()[0]!.nextAt).toBeNull()
  } finally { await engine.dispose(); rmSync(dir, { recursive: true, force: true }) }
}, 320000)
