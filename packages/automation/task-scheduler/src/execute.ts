/** The only adapter between scheduled work and the existing Agent runtime. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setTimeout as delay } from 'node:timers/promises'
import type {} from '@deepseek-ai/dsh-goal'
import type { ExecuteTask } from './types.ts'

/**
 * Bind independent execution to the Host's existing Agent services and permissions.
 * @param ctx - Host context with the injected runtime services.
 * @returns A cancellable executor that settles from durable turn events.
 */
export function agentExecutor(ctx: Context): ExecuteTask {
  return async (task, run, signal, progress) => {
    signal.throwIfAborted()
    ctx.permissionPresets.resolve(task.permissionPreset)
    const preset = await ctx.agentPresets.resolve(task.agentPreset)
    await ctx.agentPresets.standingKeyFor(preset.id)
    const workspace = await ctx.workspaceRegistry.create(task.workspace)
    const sessionId = brandString<SessionId>(run.sessionId ?? `scheduled-${run.id}`)
    const setup = async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx, preset.id) }
    const existing = ctx.agents.get(sessionId)
    if (existing && (!task.resumeSessionId || existing.status !== 'idle')) throw new Error('Execution session is busy; wait before continuing')
    const handle = existing ? { agent: existing, dispose: async () => {} } : task.resumeSessionId ? await ctx.agents.resume({
      resumeSessionId: sessionId, signal, setup,
      agentOptions: { provider: task.provider, model: task.model },
    }) : await ctx.agents.create({
      sessionId, signal, meta: { cwd: workspace.path, agentPreset: preset.id },
      agentOptions: { provider: task.provider, model: task.model },
      setup,
    })
    const cancel = () => { handle.agent.cancel({ kind: 'disposed' }) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      await workspace.attachSession(sessionId)
      if (!existing) ctx.permissionPresets.set(handle.agent.session, task.permissionPreset)
      ctx.sessionTitle.rename(handle.agent.session, `${task.kind === 'goal' ? '[Goal]' : '[Scheduled]'} ${task.title}`)
      if (task.kind === 'goal') {
        if (!ctx.tools.get('update_goal', handle.agent)) throw new Error('Goal service and goal tools must be enabled in this preset')
        let goal = ctx.goals.get(handle.agent)
        if (!task.resumeSessionId) {
          goal = ctx.goals.create(handle.agent, {
            objective: `${task.prompt}\n\n完成标准：\n${task.completionCriteria}\n\n持续推进同一目标。先检查现状，分步骤实施并验证。保存进度和验证证据。只有完成标准全部满足才调用 update_goal 标记完成；缺少信息、权限或无法验证时标记阻塞，不能把一轮回复结束当成目标完成。`,
            maxGoalRounds: task.maxGoalRounds ?? 10,
          })
        } else {
          if (!goal) throw new Error('Persisted goal is missing; refusing to restart its work')
          if (goal.phase !== 'complete') {
            if (goal.roundsStarted >= goal.maxGoalRounds) goal = ctx.goals.edit(handle.agent, goal, {
              maxGoalRounds: goal.roundsStarted + (task.maxGoalRounds ?? 10),
            })
            goal = ctx.goals.resume(handle.agent, goal)
          }
        }
        await ctx.sessions.flush(handle.agent.session)
        while (true) {
          signal.throwIfAborted()
          goal = ctx.goals.get(handle.agent)
          if (!goal) throw new Error('Goal disappeared during execution')
          const phase = { active: goal.activation === 'armed' ? '执行中' : '待继续', paused: '已暂停', blocked: '需要处理', complete: '已完成' }[goal.phase]
          const detail = `目标状态：${phase}；已执行 ${goal.roundsStarted} / ${goal.maxGoalRounds} 轮。${goal.blockedReason?.message ?? ''}`
          progress?.(detail)
          if (goal.phase !== 'active' || goal.activation !== 'armed') {
            await handle.agent.whenIdle()
            await ctx.sessions.flush(handle.agent.session)
            return { sessionId, state: goal.phase === 'complete' ? 'completed' : 'blocked', detail }
          }
          await delay(200, undefined, { signal })
        }
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: `[Scheduled task ${task.id}; occurrence ${new Date(run.scheduledAt).toISOString()}]\nThe scheduled time has arrived. Execute now; relative delays in the original instruction have already elapsed and must not be waited again.\n${task.prompt}` }],
        source: { kind: 'plugin', plugin: 'task-scheduler' },
      }))
      await handle.agent.whenIdle()
      await ctx.sessions.flush(handle.agent.session)
      signal.throwIfAborted()
      // A turn's durable settlement, not the idle lifecycle flag, determines its receipt.
      // oxlint-disable-next-line typescript/no-deprecated -- Read the dedicated execution session's durable settlement.
      const end = handle.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
      const reason = end?.type === 'turn/end' ? end.data.reason.kind : undefined
      return { sessionId, state: reason === 'completed' ? 'completed' : reason === 'blocked' ? 'blocked' : 'failed',
        detail: reason === 'completed'
          ? 'Agent turn completed. This is not a certification that code or tests passed; inspect the execution session.'
          : `Agent turn did not complete: ${reason ?? 'no durable turn/end'}` }
    } catch (error) {
      return { state: 'failed', sessionId, detail: String(error).slice(0, 2000) }
    } finally {
      signal.removeEventListener('abort', cancel)
      await handle.dispose()
    }
  }
}
