/** Opt-in task scheduler: persisted plans, scoped management, and independent Agent runs. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerTaskTool } from './tools.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TaskStore } from './store.ts'
import { SchedulerEngine } from './engine.ts'
import { startReminderJournal } from './reminder-journal.ts'
import { agentExecutor } from './execute.ts'
import type { SchedulerOptions } from './types.ts'
import { TaskSchedulerGateway } from './gateway.ts'
export { TaskSchedulerGateway } from './gateway.ts'
export type * from './gui-types.ts'

export const name = 'task-scheduler'
export const inject = ['goals', 'agents', 'sessions', 'sessionPersistence', 'tools', 'agentPresets', 'permissionPresets', 'sessionTitle', 'workspaceRegistry']
/** Configuration of one opt-in scheduler instance. */
export interface Config extends SchedulerOptions {
  /** Absolute path of a dedicated local SQLite database for plans and run receipts. */
  path: string
}
export const Config: z<Config> = z.object({
  path: z.string().required(),
  pollMs: z.number().min(100).max(60000).default(250),
  runTimeoutMs: z.number().min(1000).max(86400000).default(600000),
  maxConcurrent: z.number().min(1).max(16).default(1),
  historyLimit: z.number().min(1).max(1000).default(50),
  minEverySeconds: z.number().min(60).max(86400).default(300),
})

/** Register only into root Agent scopes; a scheduled execution cannot schedule further work. */
export function apply(ctx: Context, config: Config): void {
  for (const value of Object.values(config)) if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error('scheduler numeric options must be safe integers')
  }
  ctx.effect(() => {
    const store = new TaskStore(config.path)
    new TaskSchedulerGateway(ctx, store, config)
    const engine = new SchedulerEngine(store, agentExecutor(ctx), config, (error) => { ctx.logger.error(String(error)) })
    const owners = new Map<Agent, () => void>()
    const attach = (agent: Agent) => {
      if (owners.has(agent) || agent.id.startsWith('scheduled-') || !ctx.agents.roots().includes(agent)) return
      const dispose = registerTaskTool(ctx, agent.ctx, store, agent, config)
      owners.set(agent, dispose)
      agent.ctx.effect(() => () => { dispose(); owners.delete(agent) })
    }
    const stop = ctx.on('agent/created', ({ agent }) => { attach(agent) })
    try {
      for (const agent of ctx.agents.roots()) attach(agent)
    } catch (error) {
      stop()
      for (const dispose of owners.values()) dispose()
      owners.clear()
      store.close()
      throw error
    }
    const stopJournal = startReminderJournal(ctx, store)
    engine.start()
    return async () => {
      stop()
      for (const dispose of owners.values()) dispose()
      owners.clear()
      await stopJournal()
      await engine.dispose()
    }
  })
}
