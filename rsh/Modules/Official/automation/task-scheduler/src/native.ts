/** Opt-in native scheduled Agent work with scoped management and durable SQLite claims. */
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { TaskId, SchedulerOptions } from './types.ts'
import { TaskStore } from './store.ts'
import { NativeTaskSchedulerRegistry } from './native-registry.ts'

export type * from './native-types.ts'
export { NativeTaskSchedulerRegistry } from './native-registry.ts'

/** Absolute SQLite authority and explicit polling, timeout and retention limits. */
export interface NativeTaskSchedulerConfig extends SchedulerOptions {
  readonly path: string
}
const Configuration = z.object({
  path: z.string().refine(isAbsolute, 'scheduler database path must be absolute'),
  pollMs: z.number().int().min(100).max(60000).default(250),
  runTimeoutMs: z.number().int().min(1000).max(86400000).default(600000),
  maxConcurrent: z.number().int().min(1).max(16).default(1),
  historyLimit: z.number().int().min(1).max(1000).default(50),
  minEverySeconds: z.number().int().min(60).max(86400).default(300),
}).strict()
const Request = z.object({
  action: z.enum(['create', 'list', 'pause', 'resume', 'delete', 'history']),
  id: z.string().min(1).optional(), title: z.string().optional(), prompt: z.string().optional(),
  at: z.string().optional(), after_seconds: z.number().int().positive().optional(),
  end_at: z.string().optional(), every_seconds: z.number().int().positive().optional(),
}).strict()

/**
 * Validate profile-owned scheduler limits before opening SQLite.
 * @param input - explicit profile configuration.
 * @returns resolved configuration with validated deployment defaults.
 */
export function resolveNativeTaskSchedulerConfig(input: unknown): NativeTaskSchedulerConfig {
  return Configuration.parse(input)
}

/** Complete native Definition/Provider and scoped model-tool Consumer. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-task-scheduler', targets: ['host'],
  requires: ['rootExecution', 'activeSessions', 'agents', 'tools'], optional: [], provides: ['taskScheduler'],
  resolve(input) {
    const config = resolveNativeTaskSchedulerConfig(input)
    return (context) => {
      const store = new TaskStore(config.path)
      const agents = context.require('agents')
      const owners = context.require('activeSessions')
      const tools = context.require('tools')
      const contributions = new WeakMap<NativeAgent, () => Promise<void>>()
      let scheduler: NativeTaskSchedulerRegistry
      try {
        scheduler = new NativeTaskSchedulerRegistry(store, context.require('rootExecution'), agents, owners, async (agent) => { await contributions.get(agent)?.() },
          config, (error) => { console.warn(`native-task-scheduler: ${String(error)}`) })
      } catch (failure: unknown) { store.close(); throw failure }
      context.own(() => scheduler.dispose())
      context.provide('taskScheduler', scheduler)
      const installed = new WeakSet<NativeAgent>()
      const attachOwner = (owner: NativeActiveSessionOwner): Promise<void> => {
        if (installed.has(owner.agent)) return Promise.resolve()
        installed.add(owner.agent)
        const accepted = scheduler.accepts(owner)
        if (!accepted && !tools.schemas(owner.agent.scope).some(tool => tool.name === 'task_schedule')) return Promise.resolve()
        const registration = accepted ? tools.registerValueTool({
          schema: { name: 'task_schedule', description:
            'Manage explicitly requested persistent scheduled Agent work: create, list, pause, resume, delete or history. '
            + 'Each due occurrence executes in an independent root Session with this Program route and permissions. '
            + 'Plans survive restart; missed recurring periods coalesce. Pause/delete stops future starts, not running work. '
            + 'Interrupted receipts are not replayed. Completed records an Agent turn, not verified code correctness. '
            + 'Personal reminder delivery is unavailable. Scheduled runs cannot schedule tasks.',
          parameters: { type: 'object', properties: {
            action: { type: 'string', enum: ['create', 'list', 'pause', 'resume', 'delete', 'history'] },
            id: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' }, at: { type: 'string' },
            after_seconds: { type: 'integer' }, end_at: { type: 'string' }, every_seconds: { type: 'integer' },
          }, required: ['action'], additionalProperties: false } },
          execute: call => Promise.resolve().then(async () => {
            if (call.agent !== owner.agent || agents.currentInitiator() !== call.agent) throw new Error('Task management requires exact initiating Agent')
            const active = owners.owner(call.agent, call.session)
            if (active === undefined) throw new Error('Task management requires an attached Session')
            call.signal.throwIfAborted()
            const args = Request.parse(call.arguments)
            const id = args.id === undefined ? undefined : brandString<TaskId>(args.id)
            if (args.action === 'create') return JSON.stringify(scheduler.create(active, {
              title: args.title ?? '', prompt: args.prompt ?? '', at: args.at ?? '',
              ...args.after_seconds === undefined ? {} : { delaySeconds: args.after_seconds },
              ...args.end_at === undefined ? {} : { endAt: args.end_at },
              ...args.every_seconds === undefined ? {} : { everySeconds: args.every_seconds },
            }, call.signal))
            if (args.action === 'list') return JSON.stringify(scheduler.list(active))
            if (args.action === 'history') return JSON.stringify(scheduler.history(active, id))
            if (id === undefined) throw new Error('id is required')
            return JSON.stringify(await scheduler.change(active, id,
              args.action === 'pause' ? 'paused' : args.action === 'resume' ? 'active' : 'deleted', call.signal))
          }),
          output: { schema: { type: 'string' }, render: (_call, text) => ({ content: [{ type: 'text', text: text as string }], isError: false }) },
        }, owner.agent.scope) : tools.restrict({ deny: ['task_schedule'] }, owner.agent.scope)
        const dispose = context.effect(registration)
        const detachAgent = agents.onDispose(owner.agent, dispose)
        context.own(detachAgent)
        if (accepted) contributions.set(owner.agent, dispose)
        return Promise.resolve()
      }
      context.effect(owners.onAttached(attachOwner))
      const current = owners.owners()
      // Install accepted ancestors before adding inherited-tool denials to descendants.
      for (const owner of current.filter(candidate => scheduler.accepts(candidate))) void attachOwner(owner)
      for (const owner of current.filter(candidate => !scheduler.accepts(candidate))) void attachOwner(owner)
      void scheduler.start().catch((failure: unknown) => {
        if (!context.signal.aborted) console.warn(`native-task-scheduler: startup failed: ${String(failure)}`)
      })
    }
  },
}
