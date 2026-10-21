/** Human-facing task management over the existing authenticated Remote carrier. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-goal'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { TaskStore } from './store.ts'
import type { SchedulerOptions } from './types.ts'
import type { CreateTaskRequest, SchedulerOwner, SchedulerSnapshot, TaskNotice } from './gui-types.ts'
import { removeReminderRecord } from './reminder-journal.ts'
import { createOwnedTask } from './management.ts'
import { reminderStartTime } from './history.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskScheduler: TaskSchedulerGateway
  }
}

/** Remote-only adapter sharing the tool's ownership, permissions and task database. */
export class TaskSchedulerGateway extends TypertRemoteService {
  constructor(ctx: Context, private readonly store: TaskStore, private readonly options: SchedulerOptions) {
    super(ctx, 'taskScheduler')
  }
  private owner(agent: Agent): void {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(agent.session.id)) throw new Error('This conversation was deleted')
    if (agent.id.startsWith('scheduled-') || !this.ctx.agents.roots().includes(agent)) throw new Error('Select a normal open session')
  }
  private visibleRuns() {
    const archived = new Set<string>(this.ctx.workspaceRegistry.archivedSessionIds)
    const deleted = new Set(this.store.tasks().filter(task => task.state === 'deleted').map(task => task.id))
    return this.store.runs().filter(run => !deleted.has(run.taskId) && (!run.sessionId || !archived.has(run.sessionId)))
  }
  private visibleNotices(): TaskNotice[] {
    const archived = new Set<string>(this.ctx.workspaceRegistry.archivedSessionIds)
    const visible = new Set(this.store.tasks().filter(task => task.state !== 'deleted').map(task => String(task.id)))
    return this.store.notices(Date.now(), true).filter(item => item.taskId && visible.has(item.taskId)
      && (!item.sessionId || !archived.has(item.sessionId)))
  }
  private visibleTasks() {
    const runs = this.visibleRuns()
    return this.store.tasks().filter(task => task.state !== 'deleted'
      && (task.everySeconds !== undefined || task.nextAt !== null || runs.some(run => run.taskId === task.id)))
  }
  /**
   * Read this authenticated application's reminder inbox, including closed owners.
   * @returns Retained occurrence notifications with read status.
   */
  @Remote
  notifications(): TaskNotice[] { return this.visibleNotices() }
  /** Read all task plans and receipts for this authenticated desktop application.
   * @returns Visible plans, execution history and minimum interval.
   */
  @Remote
  overview(): SchedulerSnapshot {
    const tasks = this.store.tasks()
    return { tasks: this.visibleTasks(),
      runs: this.visibleRuns().slice(0, this.options.historyLimit).map(run => ({ ...run,
        reminderStartedAt: reminderStartTime(run, tasks.find(task => task.id === run.taskId)),
        kind: tasks.find(task => task.id === run.taskId)?.kind,
        title: tasks.find(task => task.id === run.taskId)?.title || '定时任务' })),
      minEverySeconds: this.options.minEverySeconds }
  }
  /** Change a task from the authenticated application, including closed owner conversations.
   * @param id - Task identity.
   * @param action - Requested lifecycle operation.
   * @returns Updated application-wide task snapshot.
   */
  @Remote
  async updateTask(id: string, action: 'pause' | 'resume' | 'delete'): Promise<SchedulerSnapshot> {
    const task = this.store.tasks().find(item => item.id === id)
    if (!task) throw new Error('Task not found')
    if (!(action === 'delete' && task.state === 'deleted')) this.applyChange(task.ownerSessionId, id, action)
    if (action === 'delete') {
      const sessions = new Set(this.store.runs().filter(item => item.taskId === id).map(run => run.sessionId))
      if (task.journalSessionId) sessions.add(task.journalSessionId)
      for (const sessionId of sessions) {
        if (sessionId) await this.ctx.workspaceRegistry.archiveSession(SessionId(sessionId))
      }
    }
    return this.overview()
  }
  /** Remove a finished receipt from the application-wide history.
   * @param id - Finished execution identity.
   * @returns Updated application-wide task snapshot.
   */
  @Remote
  async removeRun(id: string): Promise<SchedulerSnapshot> {
    const run = this.store.runs().find(item => item.id === id)
    const task = this.store.tasks().find(item => item.id === run?.taskId)
    if (!task) throw new Error('Run not found')
    await this.removeExecution(task.ownerSessionId, id)
    return this.overview()
  }
  /**
   * Remove a finished record and reminder belonging to the selected session.
   * @param agent - Owning root resolved by Remote.
   * @param id - Finished execution record identity.
   * @returns Updated owner-scoped records and plans.
   */
  @Remote
  async deleteRun(agent: Agent, id: string): Promise<SchedulerSnapshot> {
    this.owner(agent)
    await this.removeExecution(agent.id, id)
    return this.list(agent)
  }
  private async removeExecution(owner: string, id: string): Promise<void> {
    const run = this.store.runs().find(item => item.id === id)
    const task = this.store.tasks().find(item => item.id === run?.taskId && item.ownerSessionId === owner)
    if (!task || !run) throw new Error('Run not found in this session')
    if (run.state === 'running') throw new Error('Running records cannot be deleted')
    if (run.sessionId && task.journalSessionId === run.sessionId) await removeReminderRecord(this.ctx, this.store, task, run)
    else if (run.sessionId) await this.ctx.workspaceRegistry.archiveSession(SessionId(run.sessionId))
    this.store.deleteRun(owner, id)
  }
  /**
   * Delete one occurrence reminder without cancelling any scheduled execution.
   * @param id - Exact visible reminder identity.
   * @returns Remaining reminders after durable deletion.
   */
  @Remote
  deleteNotification(id: string): TaskNotice[] {
    this.store.deleteNotice(id)
    return this.visibleNotices()
  }
  /**
   * Mark one reminder read; viewing or closing the panel alone does not acknowledge it.
   * @param id - Exact retained notification identifier.
   * @returns Updated application inbox after durable acknowledgement.
   */
  @Remote
  acknowledge(id: string): TaskNotice[] {
    this.store.acknowledge(id)
    return this.visibleNotices()
  }
  /**
   * List open sessions without exposing credentials or changing their lifecycle.
   * @returns Eligible roots with their current workspace and execution settings.
   */
  @Remote
  owners(): SchedulerOwner[] {
    return this.ctx.agents.roots().filter(agent => !agent.id.startsWith('scheduled-') && Boolean(agent.session.header.cwd)
      && !this.ctx.workspaceRegistry.archivedSessionIds.includes(agent.session.id))
      .map(agent => ({ id: agent.session.id, title: this.ctx.sessionTitle.get(agent.session)?.title ?? agent.id,
        workspace: agent.session.header.cwd ?? '', model: agent.session.requestHeader()?.config.model ?? agent.options.model ?? '',
        permission: this.ctx.permissionPresets.current(agent.session) }))
  }
  /**
   * Read only the selected session's tasks and retained receipts.
   * @param agent - Root session resolved by the Remote Agent lookup.
   * @returns Persisted state and the minimum recurring interval.
   */
  @Remote
  list(agent: Agent): SchedulerSnapshot {
    this.owner(agent)
    const tasks = this.store.tasks().filter(task => task.ownerSessionId === agent.id)
    const ids = new Set(tasks.map(task => task.id))
    return { tasks: tasks.filter(task => task.state !== 'deleted'),
      runs: this.visibleRuns().filter(run => ids.has(run.taskId)).slice(0, this.options.historyLimit)
        .map(run => ({ ...run, kind: tasks.find(task => task.id === run.taskId)?.kind,
          reminderStartedAt: reminderStartTime(run, tasks.find(task => task.id === run.taskId)),
          title: tasks.find(task => task.id === run.taskId)?.title
          || tasks.find(task => task.id === run.taskId)?.prompt.replace(/\s+/gu, ' ').slice(0, 32) || '定时任务' })),
      minEverySeconds: this.options.minEverySeconds }
  }
  /**
   * Save a task using the selected session's model and permissions; this does not invoke a model.
   * @param agent - Creating root session resolved by the Remote Agent lookup.
   * @param input - Title, prompt, first target and optional period.
   * @returns The refreshed owner-scoped state after durable creation.
   */
  @Remote
  async create(agent: Agent, input: CreateTaskRequest): Promise<SchedulerSnapshot> {
    this.owner(agent)
    await createOwnedTask(this.ctx, this.store, agent, input, this.options.minEverySeconds)
    return this.list(agent)
  }
  /**
   * Change future admission of an owned task, without cancelling an active occurrence.
   * @param agent - Owning root session resolved by the Remote Agent lookup.
   * @param id - Task identifier belonging to that session.
   * @param action - Pause, resume or delete.
   * @returns Persisted owner-scoped state after the change.
   */
  @Remote
  change(agent: Agent, id: string, action: 'pause' | 'resume' | 'delete'): SchedulerSnapshot {
    this.owner(agent)
    this.applyChange(agent.id, id, action)
    return this.list(agent)
  }
  private applyChange(owner: string, id: string, action: 'pause' | 'resume' | 'delete'): void {
    z.enum(['pause', 'resume', 'delete']).parse(action)
    const task = this.store.tasks().find(item => item.id === id && item.ownerSessionId === owner)
    if (task?.kind === 'goal' && action === 'pause') {
      const run = this.store.runs().find(item => item.taskId === id && item.state === 'running')
      const running = run?.sessionId ? this.ctx.agents.roots().find(item => item.id === run.sessionId) : undefined
      if (running) {
        const goal = this.ctx.goals.get(running)
        if (goal?.phase === 'active') this.ctx.goals.pause(running, goal)
        running.cancel({ kind: 'disposed' })
      }
    }
    this.store.change(owner, id, action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'deleted')
  }
}
