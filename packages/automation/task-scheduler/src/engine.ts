/** Disposable polling owner; all durable decisions belong to TaskStore. */
import type { ExecuteTask, SchedulerOptions } from './types.ts'
import { TaskStore } from './store.ts'

/** Owns polling and cancellable executions for one plugin mount. */
export class SchedulerEngine {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly active = new Map<AbortController, Promise<void>>()
  private stopped = false
  constructor(readonly store: TaskStore, private readonly execute: ExecuteTask,
    private readonly options: SchedulerOptions, private readonly reportError: (error: unknown) => void) {}
  /** Start polling once after plugin composition completes. */
  start(): void { this.tick() }
  private tick(): void {
    if (this.stopped) return
    try {
      this.store.recoverExpired(Date.now())
      // Personal reminders are durable receipts, not queued model turns.
      for (;;) {
        const reminder = this.store.claim(Date.now(), this.options.runTimeoutMs, this.options.maxConcurrent, 'reminder')
        if (!reminder) break
        this.store.settle({ ...reminder.run, sessionId: reminder.task.journalSessionId ?? null, state: 'completed', detail: 'Reminder dispatched' }, Date.now(), this.options.historyLimit)
      }
      while (this.active.size < this.options.maxConcurrent) {
        const claim = this.store.claim(Date.now(), this.options.runTimeoutMs, this.options.maxConcurrent, 'agent')
        if (!claim) break
        const controller = new AbortController()
        const timeout = setTimeout(() => { controller.abort(new Error('scheduled run timed out')) }, this.options.runTimeoutMs)
        const work = Promise.resolve().then(() => {
          controller.signal.throwIfAborted()
          return this.execute(claim.task, claim.run, controller.signal, (detail) => { this.store.progress(claim.run.id, detail) })
        }).then((result) => {
          this.store.settle({ ...claim.run, ...result,
            ...(controller.signal.aborted ? { state: 'interrupted' as const, detail: 'Execution interrupted; inspect the session before retrying.' } : {}),
          }, Date.now(), this.options.historyLimit)
        }, (error: unknown) => {
          this.store.settle({ ...claim.run, state: controller.signal.aborted ? 'interrupted' : 'failed',
            detail: String(error).slice(0, 2000) }, Date.now(), this.options.historyLimit)
        }).catch(this.reportError).finally(() => { clearTimeout(timeout); this.active.delete(controller) })
        this.active.set(controller, work)
      }
    } catch (error) { this.reportError(error) }
    this.timer = setTimeout(() => { this.tick() }, this.options.pollMs)
    this.timer.unref()
  }
  /**
   * Stop admission, cancel owned runs and close the database after their disposal.
   * @returns Completion after all owned executions have settled.
   */
  async dispose(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timer)
    for (const controller of this.active.keys()) controller.abort(new Error('scheduler stopped'))
    await Promise.allSettled(this.active.values())
    this.store.close()
  }
}
