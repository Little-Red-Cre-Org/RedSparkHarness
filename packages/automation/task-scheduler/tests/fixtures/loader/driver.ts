import { mkdir, writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'

import { z } from 'zod'
import type {} from '../../../src/gateway.ts'

const runsSchema = z.array(z.object({ state: z.string(), sessionId: z.string().nullable(), detail: z.string() }))

await mkdir('presets/test', { recursive: true })
await writeFile('presets/test/agent.cordis.yml', "- name: '@deepseek-ai/dsh-tool-goal'\n")
const ctx = await boot('task-scheduler-smoke', resolveConfigPath(process.argv[2]!, undefined))
try {
  const handle = await ctx.agents.create({ sessionId: SessionId('scheduler-owner'),
    meta: { cwd: process.cwd(), agentPreset: 'test' }, agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'test') },
  })
  const agent = handle.agent
  let scheduledHasManagementTool = false
  ctx.on('agent/created', ({ agent: created }) => {
    if (created.id.startsWith('scheduled-')) scheduledHasManagementTool ||= Boolean(ctx.tools.get('task_schedule', created))
  })
  const call = async (args: object) => {
    const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId(`call-${Math.random()}`),
      name: 'task_schedule', arguments: args, agent,
    }))
    if (result.isError) throw new Error(JSON.stringify(result))
    if (typeof result.value !== 'string') throw new Error('expected JSON text from task_schedule')
    return JSON.parse(result.value) as unknown
  }
  const description = ctx.tools.get('task_schedule', agent)?.description
  const managed = z.object({ id: z.string() }).parse(await call({ action: 'create', title: 'Management', prompt: 'Check the project.',
    at: new Date(Date.now() + 60000).toISOString(), every_seconds: 300 }))
  const stateSchema = z.object({ state: z.string() })
  const paused = stateSchema.parse(await call({ action: 'pause', id: managed.id })).state
  const resumed = stateSchema.parse(await call({ action: 'resume', id: managed.id })).state
  const deleted = stateSchema.parse(await call({ action: 'delete', id: managed.id })).state
  const other = await ctx.agents.create({ sessionId: SessionId('scheduler-other'),
    meta: { cwd: process.cwd(), agentPreset: 'test' }, agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'test') },
  })
  const denied = await ctx.agents.withInitiator(other.agent, () => ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId('other-history'), name: 'task_schedule',
    arguments: { action: 'history', id: managed.id }, agent: other.agent,
  }))
  const beforeDelay = Date.now()
  const guiCreated = await ctx.taskScheduler.create(agent, { title: 'GUI task', prompt: 'Do not run yet.', at: '', delaySeconds: 120 })
  const guiTask = guiCreated.tasks.find(item => item.title === 'GUI task')
  if (!guiTask) throw new Error('GUI did not persist its task')
  if (Date.parse(guiTask.at) < beforeDelay + 120000 || Date.parse(guiTask.at) > Date.now() + 120000) {
    throw new Error('Relative time was rounded or scheduled early')
  }
  const countdownAt = new Date(Date.now() + 600000).toISOString()
  const durationStart = Date.now() + 1000
  const durationCreated = await ctx.taskScheduler.create(agent, { title: 'Exact duration check',
    prompt: '每隔5分钟提醒我喝水，持续21分钟', at: new Date(durationStart).toISOString(),
    endAt: new Date(durationStart + 1260000).toISOString(), delaySeconds: 300, everySeconds: 300 })
  const durationTask = durationCreated.tasks.find(item => item.title === 'Exact duration check')!
  if (Date.parse(durationTask.endAt!) - Date.parse(durationTask.countdownStartedAt!) !== 1260000
    || Date.parse(durationTask.at) - Date.parse(durationTask.countdownStartedAt!) !== 300000) {
    throw new Error('Relative schedule endpoints must use the same persisted creation clock')
  }
  await ctx.taskScheduler.updateTask(durationTask.id, 'delete')
  const countdownCreated = await ctx.taskScheduler.create(agent, { title: 'Countdown check', prompt: '五分钟后提醒我喝水', at: countdownAt, delaySeconds: 300, delayFromAt: true })
  const countdownTask = countdownCreated.tasks.find(item => item.title === 'Countdown check')!
  if (countdownTask.countdownStartedAt !== countdownAt || Date.parse(countdownTask.at) !== Date.parse(countdownAt) + 300000) {
    throw new Error('Countdown did not use the selected start plus five full minutes')
  }
  await ctx.taskScheduler.updateTask(countdownTask.id, 'delete')
  const historyPlan = await ctx.taskScheduler.create(agent, { title: 'Deleted countdown history', prompt: '一秒后提醒我喝水', at: '', delaySeconds: 1 })
  const historyTask = historyPlan.tasks.find(item => item.title === 'Deleted countdown history')!
  let historyRun = ctx.taskScheduler.overview().runs.find(item => item.taskId === historyTask.id)
  for (let attempt = 0; attempt < 100 && historyRun?.state !== 'completed'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    historyRun = ctx.taskScheduler.overview().runs.find(item => item.taskId === historyTask.id)
  }
  if (historyRun?.state !== 'completed') throw new Error('Countdown reminder did not complete')
  ctx.taskScheduler.change(agent, historyTask.id, 'delete')
  for (const snapshot of [ctx.taskScheduler.list(agent), ctx.taskScheduler.overview()]) {
    if (snapshot.tasks.some(item => item.id === historyTask.id)) throw new Error('Deleted countdown remains visible')
    if (snapshot.runs.some(item => item.id === historyRun.id)) throw new Error('Deleted task history remains visible')
  }
  if (ctx.taskScheduler.notifications().some(item => item.taskId === historyTask.id)) throw new Error('Deleted task reminder remains visible')
  await ctx.taskScheduler.removeRun(historyRun.id)
  let guiOtherDenied = false
  try { ctx.taskScheduler.change(other.agent, guiTask.id, 'delete') } catch { guiOtherDenied = true }
  const guiPaused = ctx.taskScheduler.change(agent, guiTask.id, 'pause').tasks.find(item => item.id === guiTask.id)?.state
  const guiResumed = ctx.taskScheduler.change(agent, guiTask.id, 'resume').tasks.find(item => item.id === guiTask.id)?.state
  const guiDeleted = !ctx.taskScheduler.change(agent, guiTask.id, 'delete').tasks.some(item => item.id === guiTask.id)
  const task = z.object({ id: z.string() }).parse(await call({ action: 'create', title: 'Smoke', prompt: 'Reply with a short completion message.', at: new Date(Date.now() + 500).toISOString() }))
  let runs: z.infer<typeof runsSchema> = []
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    runs = runsSchema.parse(await call({ action: 'history', id: task.id }))
    if (runs.length && runs[0]!.state !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const notifications = ctx.taskScheduler.notifications()
  const reminder = notifications.find(item => item.title === 'Smoke' && item.phase === 'completed')
  if (!reminder || reminder.read) throw new Error('Real scheduled execution did not publish an unread due reminder')
  if (!ctx.taskScheduler.acknowledge(reminder.id).find(item => item.id === reminder.id)?.read) throw new Error('Reminder acknowledgement was not persisted')
  if (ctx.taskScheduler.deleteNotification(reminder.id).some(item => item.id === reminder.id && !item.dismissed)) throw new Error('Reminder deletion was not persisted')
  if (!ctx.taskScheduler.list(agent).runs.some(run => run.sessionId === reminder.sessionId)) throw new Error('Deleting a reminder removed its execution receipt')
  ctx.taskScheduler.change(agent, task.id, 'delete')
  if (ctx.taskScheduler.list(agent).runs.some(run => run.title === 'Smoke')) throw new Error('Deleted plan history remains visible')
  const goalTask = z.object({ id: z.string() }).parse(await call({ action: 'create', kind: 'goal', title: 'Goal smoke',
    prompt: 'Finish the example goal.', completion_criteria: 'Report the verified result.', max_goal_rounds: 1,
    at: new Date(Date.now() + 500).toISOString() }))
  const waitGoal = async () => {
    const until = Date.now() + 15000
    while (Date.now() < until) {
      const result = ctx.taskScheduler.list(agent).runs.find(run => run.taskId === goalTask.id)
      if (result && result.state !== 'running') return result
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Goal did not settle')
  }
  const blockedGoal = await waitGoal()
  if (blockedGoal.state !== 'blocked') throw new Error('Unexpected goal settlement: ' + JSON.stringify(blockedGoal))
  const viewed = await ctx.agents.resume({ resumeSessionId: SessionId(blockedGoal.sessionId!),
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'test') },
  })
  ctx.taskScheduler.change(agent, goalTask.id, 'resume')
  await new Promise(resolve => setTimeout(resolve, 300))
  const completedGoal = await waitGoal()
  if (completedGoal.state !== 'completed' || completedGoal.sessionId !== blockedGoal.sessionId) {
    throw new Error('Goal continuation failed: ' + JSON.stringify(completedGoal))
  }
  if (ctx.agents.get(viewed.agent.id) !== viewed.agent) throw new Error('Continuation disposed a user-opened session')
  await viewed.dispose()
  const reminderPlan = await ctx.taskScheduler.create(agent, { kind: 'scheduled', title: 'Journal test', prompt: '每五分钟提醒我喝水',
    at: new Date(Date.now() + 100).toISOString(), everySeconds: 300 })
  const reminderId = reminderPlan.tasks.find(item => item.title === 'Journal test')!.id
  let journalRun = ctx.taskScheduler.overview().runs.find(item => item.taskId === reminderId)
  for (let attempt = 0; attempt < 100 && !journalRun?.sessionId; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    journalRun = ctx.taskScheduler.overview().runs.find(item => item.taskId === reminderId)
  }
  if (!journalRun?.sessionId || journalRun.state !== 'completed') throw new Error('Reminder journal was not bound')
  const journal = await ctx.agents.resume({ resumeSessionId: SessionId(journalRun.sessionId), agentOptions: { provider: 'mock', model: 'mock' } })
  const records = journal.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && String(event.data.id) === `reminder-${journalRun.id}`)
  if (records.length !== 1) throw new Error('Reminder record missing from persisted shared conversation')
  if (journal.agent.session.snapshotEvents().some(event => event.type === 'assistant/message')) throw new Error('Reminder invoked model')
  const retained = createUserMessage({ source: { kind: 'plugin', plugin: 'task-scheduler', form: 'notice', summary: 'Older reminder retained beyond receipt pruning' }, content: [{ type: 'text', text: 'Keep this old reminder' }] })
  journal.agent.session.append('user/message', { ...retained, id: brandString<typeof retained.id>('reminder-retained') }, { surfaceOp: 'append' })
  await ctx.sessions.flush(journal.agent.session)
  await journal.dispose()
  await ctx.taskScheduler.removeRun(journalRun.id)
  const replacement = ctx.taskScheduler.overview().tasks.find(item => item.id === reminderId)?.journalSessionId
  if (!replacement || ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(replacement))) throw new Error('Remaining shared journal is unavailable')
  const reopened = await ctx.agents.resume({ resumeSessionId: SessionId(replacement), agentOptions: { provider: 'mock', model: 'mock' } })
  const remainingIds = reopened.agent.session.deriveMessages().map(message => String(message.id))
  if (!remainingIds.includes('reminder-retained') || remainingIds.includes(`reminder-${journalRun.id}`)) throw new Error('Shared record deletion lost or retained incorrect content')
  await reopened.dispose()
  if (ctx.taskScheduler.overview().runs.some(item => item.id === journalRun.id)) throw new Error('Journal receipt deletion failed')
  await ctx.taskScheduler.updateTask(reminderId, 'delete')
  await writeFile('scheduler-report.json', JSON.stringify({ description, runs, goal: { blocked: blockedGoal.state, completed: completedGoal.state, sameSession: true },
    gui: { listedOwner: ctx.taskScheduler.owners().some(item => item.id === agent.id), guiOtherDenied, guiPaused, guiResumed, guiDeleted },
    management: { paused, resumed, deleted, otherSessionDenied: denied.isError, scheduledHasManagementTool },
    tasks: await call({ action: 'list' }),
  }))
  await ctx.workspaceRegistry.archiveSession(other.agent.session.id)
  if (ctx.taskScheduler.owners().some(item => item.id === other.agent.id)) throw new Error('Deleted conversation remains selectable')
  let archivedDenied = false
  try { ctx.taskScheduler.list(other.agent) } catch { archivedDenied = true }
  if (!archivedDenied) throw new Error('Deleted conversation still permits scheduler management')
  const beforeClose = ctx.taskScheduler.overview()
  await ctx.taskScheduler.removeRun(completedGoal.id)
  if (!ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(completedGoal.sessionId!))) {
    throw new Error('Deleting history did not delete its sidebar execution conversation')
  }
  if (ctx.taskScheduler.overview().runs.some(run => run.sessionId === completedGoal.sessionId)
    || ctx.taskScheduler.notifications().some(item => item.sessionId === completedGoal.sessionId)) {
    throw new Error('Deleted execution conversation left visible history or notifications')
  }
  if (!beforeClose.tasks.some(item => item.id === goalTask.id)) throw new Error('Global task center omitted a saved task')
  if (ctx.taskScheduler.overview().tasks.some(item => item.id === goalTask.id)) throw new Error('Deleted single execution left a task card')
  const pending = await ctx.taskScheduler.create(agent, { title: 'Pending', prompt: 'Future', at: '', delaySeconds: 3600 })
  const pendingId = pending.tasks.find(item => item.title === 'Pending')!.id
  await handle.dispose()
  if (!ctx.taskScheduler.overview().tasks.some(item => item.id === pendingId)) throw new Error('Closing owner hid its task')
  if ((await ctx.taskScheduler.updateTask(pendingId, 'delete')).tasks.some(item => item.id === pendingId)) {
    throw new Error('Global deletion did not synchronize')
  }
} finally { await ctx.fiber.dispose() }
