/** Persist reminder occurrences in one conversation without invoking a model. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Task, Run } from './types.ts'
import type { TaskStore } from './store.ts'
import { isDirectReminder, readableBeijingTime } from './time.ts'

/** Replay is idempotent: a committed message identity is the durable occurrence checkpoint.
 * @param session - Shared reminder conversation.
 * @param task - Owning task.
 * @param runs - Retained occurrences to append.
 */
export function appendReminderRecords(session: Session, task: Task, runs: Run[]): void {
  const seen = new Set(session.deriveMessages().map(message => String(message.id)))
  for (const run of [...runs].sort((a, b) => a.scheduledAt - b.scheduledAt)) {
    const id = `reminder-${run.id}`
    if (run.state === 'running' || seen.has(id)) continue
    const when = readableBeijingTime(run.finishedAt ?? run.startedAt)
    const status = run.state === 'completed' ? '已提醒' : '未完成'
    const summary = `${when} · ${task.title} · ${status}`.slice(0, 120)
    const message = createUserMessage({ source: { kind: 'plugin', plugin: 'task-scheduler', form: 'notice', summary },
      content: [{ type: 'text', text: `${summary}\n${task.prompt}\n计划时间：${readableBeijingTime(run.scheduledAt)}\n实际时间：${when}` }] })
    session.append('user/message', { ...message, id: brandString<typeof message.id>(id) }, { surfaceOp: 'append' })
    seen.add(id)
  }
}

/** Serial background journal writer, independent of the reminder admission clock.
 * @param ctx - Host composition owning persistence and Agent services.
 * @param store - Authoritative task and receipt store.
 * @returns Async disposer that drains the active journal write.
 */
export function startReminderJournal(ctx: Context, store: TaskStore): () => Promise<void> {
  const synced = new Map<string, string>()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()
  const sync = async () => {
    const archived = new Set<string>(ctx.workspaceRegistry.archivedSessionIds)
    for (const task of store.tasks()) {
      if (stopped || task.state === 'deleted' || task.everySeconds === undefined || !isDirectReminder(task)) continue
      const runs = store.runs().filter(run => run.taskId === task.id && run.state !== 'running')
      if (!runs.length) continue
      const signature = runs.map(run => `${run.id}:${run.state}:${run.finishedAt}`).join()
      if (synced.get(task.id) === signature) continue
      const previous = runs.find(run => run.sessionId && !archived.has(run.sessionId))?.sessionId
      const id = SessionId(task.journalSessionId ?? previous ?? `scheduled-reminder-${task.id}`)
      if (archived.has(id)) continue
      const existing = ctx.agents.get(id)
      if (existing && existing.status !== 'idle') continue
      const preset = await ctx.agentPresets.resolve(task.agentPreset)
      const setup = async (scope: Context) => { await ctx.agentPresets.mount(scope, preset.id) }
      const handle = existing ? undefined : (task.journalSessionId || previous)
        ? await ctx.agents.resume({ resumeSessionId: id, setup, agentOptions: { provider: task.provider, model: task.model } })
        : await ctx.agents.create({ sessionId: id, setup, meta: { cwd: task.workspace, agentPreset: preset.id },
          agentOptions: { provider: task.provider, model: task.model } })
      const agent = existing ?? handle?.agent
      if (!agent) throw new Error('Reminder session unavailable')
      try {
        const workspace = await ctx.workspaceRegistry.create(task.workspace)
        await workspace.attachSession(id)
        ctx.sessionTitle.rename(agent.session, `[Scheduled] ${task.title}`)
        appendReminderRecords(agent.session, task, runs)
        await ctx.sessions.flush(agent.session)
        store.bindReminderSession(task.id, id)
        synced.set(task.id, signature)
      } finally { await handle?.dispose() }
    }
  }
  const tick = () => {
    pending = sync().catch((error: unknown) => { ctx.logger.error(`Reminder journal: ${String(error)}`) }).finally(() => {
      if (!stopped) { timer = setTimeout(tick, 1000); timer.unref() }
    })
  }
  tick()
  return async () => { stopped = true; clearTimeout(timer); await pending }
}

/** Rebuild the shared journal without one entry, retaining every other durable reminder.
 * @param ctx - Host composition.
 * @param store - Authoritative task and receipt store.
 * @param task - Owning recurring reminder.
 * @param run - Receipt to remove from the journal.
 */
export async function removeReminderRecord(ctx: Context, store: TaskStore, task: Task, run: Run): Promise<void> {
  if (!run.sessionId) return
  const oldId = SessionId(run.sessionId)
  const existing = ctx.agents.get(oldId)
  if (existing && existing.status !== 'idle') throw new Error('会话正在执行，请结束后再删除记录。')
  if (existing) await ctx.sessions.flush(existing.session)
  const source = await ctx.sessionPersistence.open(oldId, 'read')
  const id = SessionId(`scheduled-reminder-${randomUUID()}`)
  const handle = await ctx.agents.create({ sessionId: id, meta: { cwd: task.workspace, agentPreset: task.agentPreset },
    agentOptions: { provider: task.provider, model: task.model },
    setup: async (scope) => { await ctx.agentPresets.mount(scope, task.agentPreset) },
  })
  try {
    const seen = new Set<string>()
    for (let offset = 0; ; offset += 200) {
      const page = await source.read(offset, 200)
      for (const event of page.events) {
        if (event.type !== 'user/message' || !String(event.data.id).startsWith('reminder-')) continue
        if (String(event.data.id) === `reminder-${run.id}` || seen.has(event.data.id)) continue
        handle.agent.session.append('user/message', event.data, { surfaceOp: 'append' })
        seen.add(event.data.id)
      }
      if (page.events.length < 200) break
    }
    ctx.sessionTitle.rename(handle.agent.session, `[Scheduled] ${task.title}`)
    await ctx.sessions.flush(handle.agent.session)
    const workspace = await ctx.workspaceRegistry.create(task.workspace)
    await workspace.attachSession(id)
    store.bindReminderSession(task.id, id)
    await ctx.workspaceRegistry.archiveSession(oldId)
  } finally { await source.close(); await handle.dispose() }
}
