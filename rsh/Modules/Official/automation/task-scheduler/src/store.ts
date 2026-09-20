/** Transactional task claims. A claimed occurrence is never automatically replayed. */
import { isDirectReminder } from './time.ts'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { Run, RunId, Task, TaskId, TaskInput } from './types.ts'
import type { TaskNotice } from './gui-types.ts'

const inputSchema = z.object({
  countdownStartedAt: z.iso.datetime({ offset: true }).optional(),
  kind: z.enum(['goal', 'scheduled']).optional(),
  completionCriteria: z.string().trim().min(1).max(8000).optional(),
  maxGoalRounds: z.number().int().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(32000),
  workspace: z.string().refine(isAbsolute, 'workspace must be absolute'),
  agentPreset: z.string().min(1), permissionPreset: z.string().min(1),
  provider: z.string().min(1), model: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }).optional(),
  everySeconds: z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER / 1000)).optional(),
}).strict()
const taskSchema = inputSchema.extend({
  pausedRemainingMs: z.number().int().nonnegative().optional(),
  resumeSessionId: z.string().min(1).optional(),
  id: z.uuid(), ownerSessionId: z.string().min(1),
  journalSessionId: z.string().optional(),
  state: z.enum(['active', 'paused', 'deleted']), nextAt: z.number().int().nullable(),
})
const runSchema = z.object({
  id: z.uuid(), taskId: z.uuid(), scheduledAt: z.number().int(),
  startedAt: z.number().int(), deadline: z.number().int(), finishedAt: z.number().int().nullable(),
  state: z.enum(['running', 'completed', 'failed', 'blocked', 'interrupted']),
  sessionId: z.string().nullable(), detail: z.string(),
}).strict()

/** Dedicated SQLite authority for plans and transactional occurrence claims. */
export class TaskStore {
  private readonly db: DatabaseSync
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error('scheduler database path must be absolute')
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      const version = this.db.prepare('PRAGMA user_version').get()?.['user_version']
      if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4) throw new Error(`unsupported scheduler database version: ${String(version)}`)
      this.db.exec('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(task_id, scheduled_at));')
      this.tasks()
      this.runs()
      this.db.exec('CREATE TABLE IF NOT EXISTS notice_reads (id TEXT PRIMARY KEY, run_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS notice_deleted (id TEXT PRIMARY KEY); PRAGMA user_version=4;')
    } catch (error) { this.db.close(); throw error }
  }
  /** Bind every retained reminder receipt to its single conversation after durable publication.
   * @param id - Task identity.
   * @param sessionId - Durably published shared conversation identity.
   */
  bindReminderSession(id: TaskId, sessionId: string): void {
    this.transaction(() => {
      const task = this.tasks().find(item => item.id === id)
      if (!task || task.state === 'deleted') return
      this.writeTask({ ...task, journalSessionId: sessionId })
      for (const run of this.runs().filter(item => item.taskId === id && item.state !== 'running')) {
        if (run.sessionId !== sessionId) this.writeRun({ ...run, sessionId })
      }
    })
  }
  /** Close this connection after its execution owner has drained all work. */
  close(): void { this.db.close() }
  /** Persist the latest execution checkpoint without changing claim ownership.
   * @param id - Running receipt identity.
   * @param detail - Latest execution checkpoint.
   */
  progress(id: RunId, detail: string): void {
    const run = this.runs().find(item => item.id === id)
    if (run?.state === 'running' && run.detail !== detail) this.writeRun({ ...run, detail })
  }
  /**
   * Read application-local reminders from committed plans and run receipts, even while execution is queued.
   * @param now - Current Unix time in milliseconds used to detect due plans.
   * @param includeDismissed - Retain hidden inbox items for independent desktop outcome delivery.
   * @returns Latest 100 due/result notices, including durable read status.
   */
  notices(now = Date.now(), includeDismissed = false): TaskNotice[] {
    const tasks = new Map(this.tasks().map(task => [task.id, task]))
    const read = new Set(this.db.prepare('SELECT id FROM notice_reads').all().map(row => String(row['id'])))
    const notices = this.runs().flatMap((run): TaskNotice[] => {
      const task = tasks.get(run.taskId)
      if (!task) return []
      const dueId = `${task.id}:${run.scheduledAt}:due`
      const due: TaskNotice = { id: dueId, taskId: task.id, title: task.title, body: task.prompt.slice(0, 2000),
        time: run.finishedAt ?? run.startedAt, phase: 'due', sessionId: run.sessionId, read: read.has(dueId) || read.has(`${run.id}:due`) }
      return [{ ...due, directReminder: run.detail === 'Reminder dispatched', phase: run.state === 'running' ? 'due' : run.state,
        ...(task.everySeconds === undefined ? {} : { recurring: true, nextAt: task.nextAt, planState: task.state,
          ...(task.endAt === undefined ? {} : { endAt: task.endAt }) }),
        read: due.read || read.has(`${run.id}:result`) }]
    })
    for (const task of tasks.values()) {
      if (task.state !== 'active' || task.nextAt === null || task.nextAt > now || (task.endAt !== undefined && now >= Date.parse(task.endAt))) continue
      const period = task.everySeconds === undefined ? undefined : task.everySeconds * 1000
      const time = period === undefined ? task.nextAt : task.nextAt + Math.floor((now - task.nextAt) / period) * period
      const id = `${task.id}:${time}:due`
      notices.push({ id, taskId: task.id, recurring: task.everySeconds !== undefined, title: task.title, body: task.prompt.slice(0, 2000), time, phase: 'due', sessionId: null, read: read.has(id) })
    }
    const deleted = new Set(this.db.prepare('SELECT id FROM notice_deleted').all().map(row => String(row['id'])))
    return notices.filter(item => includeDismissed || !deleted.has(item.id))
      .map(item => deleted.has(item.id) ? { ...item, dismissed: true } : item)
      .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id)).slice(0, 100)
  }
  /**
   * Remove one reminder durably without changing its plan or execution receipt.
   * @param id - Exact visible occurrence notification identifier.
   */
  deleteNotice(id: string): void {
    if (!this.notices().some(item => item.id === id)) throw new Error('Notification no longer exists')
    this.db.prepare('INSERT OR IGNORE INTO notice_deleted(id) VALUES (?)').run(id)
  }
  /**
   * Delete a finished owned receipt and its reminder, preserving the transcript and plan.
   * @param owner - Creating session identity.
   * @param id - Finished receipt identity.
   */
  deleteRun(owner: string, id: string): void {
    this.transaction(() => {
      const run = this.runs().find(item => item.id === id)
      if (!run || !this.tasks().some(task => task.id === run.taskId && task.ownerSessionId === owner)) throw new Error('Run not found in this session')
      if (run.state === 'running') throw new Error('Running records cannot be deleted')
      const noticeId = `${run.taskId}:${run.scheduledAt}:due`
      this.db.prepare('DELETE FROM notice_reads WHERE id=? OR run_id=?').run(noticeId, run.id)
      this.db.prepare('DELETE FROM notice_deleted WHERE id=?').run(noticeId)
      this.db.prepare('DELETE FROM runs WHERE id=?').run(id)
    })
  }
  /**
   * Persist a user's acknowledgement after resolving an existing notice.
   * @param id - Exact due/result notice identifier from the inbox.
   */
  acknowledge(id: string): void {
    const notice = this.notices().find(item => item.id === id)
    if (!notice) throw new Error('Notification no longer exists')
    this.db.prepare('INSERT OR IGNORE INTO notice_reads(id, run_id) VALUES (?, ?)').run(id, id.slice(0, id.lastIndexOf(':')))
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = fn(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  /**
   * Read and validate persisted plans, including deleted tombstones.
   * @returns Plans ordered by creation.
   */
  tasks(): Task[] {
    return this.db.prepare('SELECT body FROM tasks ORDER BY rowid').all().map(row =>
      taskSchema.parse(JSON.parse(String(row['body']))) as Task)
  }
  /**
   * Read and validate retained occurrence receipts.
   * @returns Receipts ordered by newest claim first.
   */
  runs(): Run[] {
    return this.db.prepare('SELECT body FROM runs ORDER BY rowid DESC').all().map(row =>
      runSchema.parse(JSON.parse(String(row['body']))) as Run)
  }
  private writeTask(task: Task): void {
    this.db.prepare('INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id, JSON.stringify(task))
  }
  private writeRun(run: Run): void {
    this.db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(run.id, run.taskId, run.scheduledAt, JSON.stringify(run))
  }
  /**
   * Validate and persist a new plan without starting execution.
   * @param ownerSessionId - Exact session permitted to manage this plan.
   * @param input - Intent and captured runtime configuration.
   * @param now - Current Unix time in milliseconds.
   * @param minEverySeconds - Minimum permitted recurring interval.
   * @returns The persisted active plan.
   */
  create(ownerSessionId: string, input: TaskInput, now: number, minEverySeconds: number): Task {
    const parsed = inputSchema.parse(input)
    if (parsed.kind === 'goal' && (!parsed.completionCriteria || parsed.everySeconds !== undefined)) {
      throw new Error('Goal tasks require completion criteria and cannot repeat on a timer')
    }
    const nextAt = Date.parse(parsed.at)
    if (!Number.isSafeInteger(nextAt) || nextAt <= now) throw new Error('at must be a future time with an explicit UTC offset')
    if (parsed.endAt !== undefined && Date.parse(parsed.endAt) <= nextAt) throw new Error('endAt must be later than at')
    if (parsed.everySeconds !== undefined && !Number.isSafeInteger(nextAt + parsed.everySeconds * 1000)) throw new Error('recurrence exceeds the supported timestamp range')
    if (parsed.everySeconds !== undefined && parsed.everySeconds < minEverySeconds) throw new Error(`everySeconds must be at least ${minEverySeconds}`)
    const task: Task = { ...parsed, id: brandString<TaskId>(randomUUID()), ownerSessionId, state: 'active', nextAt }
    taskSchema.parse(task)
    this.transaction(() => { this.writeTask(task) })
    return task
  }
  /**
   * Change future admission without cancelling an already claimed occurrence.
   * @param owner - Exact creating session.
   * @param id - Plan identity.
   * @param state - Target admission state.
   * @returns The updated plan; throws for inaccessible or finished plans.
   */
  change(owner: string, id: string, state: Task['state']): Task {
    return this.transaction(() => {
      const task = this.tasks().find(task => task.id === id && task.ownerSessionId === owner && task.state !== 'deleted')
      if (!task) throw new Error('task not found in this session')
      const now = Date.now()
      if (task.kind !== 'goal' && state === 'paused' && task.state !== 'paused' && task.nextAt !== null) {
        task.pausedRemainingMs = Math.max(0, task.nextAt - now)
      }
      if (state === 'active' && task.kind === 'goal' && task.nextAt === null) {
        const previous = this.runs().find(run => run.taskId === id)
        if (!previous || previous.state === 'running' || previous.state === 'completed' || !previous.sessionId) {
          throw new Error('Only a stopped, unfinished goal can continue')
        }
        task.resumeSessionId = previous.sessionId
        task.nextAt = Math.max(Date.now(), previous.scheduledAt + 1)
      }
      if (state === 'active' && task.nextAt === null) throw new Error('a finished one-shot task cannot be resumed')
      if (state === 'active' && !task.resumeSessionId && task.endAt !== undefined && Date.now() >= Date.parse(task.endAt)) throw new Error('the schedule window has ended')
      if (task.kind !== 'goal' && state === 'active' && task.state === 'paused' && task.nextAt !== null) {
        // Legacy paused plans have no frozen delay; restart their original wait rather than replay missed occurrences.
        const remaining = task.pausedRemainingMs ?? (task.everySeconds !== undefined ? task.everySeconds * 1000
          : task.countdownStartedAt ? Math.max(0, Date.parse(task.at) - Date.parse(task.countdownStartedAt))
            : Math.max(0, task.nextAt - now))
        const nextAt = now + remaining
        if (!Number.isSafeInteger(nextAt)) throw new Error('recurrence exceeds the supported timestamp range')
        if (task.endAt !== undefined && nextAt >= Date.parse(task.endAt)) throw new Error('Resumed execution would reach or exceed the schedule end time')
        task.nextAt = nextAt
        delete task.pausedRemainingMs
      }
      if (state === 'deleted') delete task.pausedRemainingMs
      task.state = state
      this.writeTask(task)
      return task
    })
  }
  /**
   * Claim and advance together, coalescing missed intervals to the latest due occurrence.
   * @param now - Current Unix time in milliseconds.
   * @param timeoutMs - Maximum occurrence execution duration.
   * @param maxConcurrent - Database-wide running claim limit.
   * @param mode - Restrict admission to reminders, Agent work, or both.
   * @returns The admitted occurrence, or undefined when no work can be admitted.
   */
  claim(now: number, timeoutMs: number, maxConcurrent: number, mode: 'all' | 'reminder' | 'agent' = 'all'): { task: Task; run: Run } | undefined {
    return this.transaction(() => {
      const runs = this.runs()
      for (const plan of this.tasks()) {
        if (!plan.resumeSessionId && plan.nextAt !== null && plan.endAt !== undefined && now >= Date.parse(plan.endAt)) {
          plan.nextAt = null
          this.writeTask(plan)
        }
      }
      if (mode !== 'reminder' && runs.filter(run => run.state === 'running').length >= maxConcurrent) return undefined
      const task = this.tasks().filter(task => (mode === 'all' || isDirectReminder(task) === (mode === 'reminder')) && task.state === 'active' && task.nextAt !== null && task.nextAt <= now
        && !runs.some(run => run.taskId === task.id && run.state === 'running')).sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))[0]
      if (!task || task.nextAt === null) return undefined
      const period = task.everySeconds === undefined ? undefined : task.everySeconds * 1000
      const scheduledAt = period === undefined ? task.nextAt : task.nextAt + Math.floor((now - task.nextAt) / period) * period
      const run: Run = { id: brandString<RunId>(randomUUID()), taskId: task.id, scheduledAt, startedAt: now,
        deadline: now + timeoutMs, finishedAt: null, state: 'running', sessionId: null, detail: '' }
      run.sessionId = task.resumeSessionId ?? `scheduled-${run.id}`
      task.nextAt = period === undefined ? null : scheduledAt + period
      if (task.nextAt !== null && task.endAt !== undefined && task.nextAt >= Date.parse(task.endAt)) task.nextAt = null
      this.writeRun(run)
      this.writeTask(task)
      return { task, run }
    })
  }
  /**
   * Settle only a running claim and prune older finished receipts for its task.
   * @param run - Claim with its final result.
   * @param now - Actual settlement time in Unix milliseconds.
   * @param limit - Maximum retained finished receipts for this task.
   */
  settle(run: Run, now: number, limit: number): void {
    this.transaction(() => {
      const current = this.runs().find(item => item.id === run.id)
      if (!current || current.state !== 'running') return
      this.writeRun({ ...run, finishedAt: now })
      const finished = this.runs().filter(item => item.taskId === run.taskId && item.state !== 'running')
      for (const old of finished.slice(limit)) {
        this.db.prepare('DELETE FROM notice_deleted WHERE id=?').run(`${old.taskId}:${old.scheduledAt}:due`)
        this.db.prepare('DELETE FROM notice_reads WHERE id=?').run(`${old.taskId}:${old.scheduledAt}:due`)
        this.db.prepare('DELETE FROM notice_reads WHERE run_id=?').run(old.id)
        this.db.prepare('DELETE FROM runs WHERE id=?').run(old.id)
      }
    })
  }
  /**
   * Mark expired claims uncertain and pause their tasks instead of replaying effects.
   * @param now - Current Unix time in milliseconds.
   */
  recoverExpired(now: number): void {
    this.transaction(() => {
      for (const run of this.runs()) if (run.state === 'running' && run.deadline <= now) {
        this.writeRun({ ...run, state: 'interrupted', finishedAt: now, detail: 'Execution deadline expired; side effects may have occurred. This occurrence will not be replayed.' })
        const task = this.tasks().find(task => task.id === run.taskId)
        if (task?.state === 'active') this.writeTask({ ...task, state: 'paused' })
      }
    })
  }
}
