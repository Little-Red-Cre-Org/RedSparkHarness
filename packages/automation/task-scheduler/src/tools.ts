/** Scoped conversational management of persistent tasks. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TaskStore } from './store.ts'
import type { SchedulerOptions } from './types.ts'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { createOwnedTask } from './management.ts'

/**
 * Register one session-owned management tool.
 * @param ctx - Host providing preset and permission resolution.
 * @param toolCtx - Owning registration scope.
 * @param store - Durable plan and receipt authority.
 * @param agent - Exact root Agent allowed to invoke this registration.
 * @param config - Creation and history response limits.
 * @returns The registration disposer.
 */
export function registerTaskTool(ctx: Context, toolCtx: Context, store: TaskStore, agent: Agent, config: Pick<SchedulerOptions, 'minEverySeconds' | 'historyLimit'>): () => void {
  return toolCtx.tools.register(defineTool({
    name: 'task_schedule',
    description: 'Manage this session\'s persistent Agent tasks: create, list, pause, resume, delete, or history. Only create tasks when the user requests scheduled work or explicitly requests sustained goal work. Goal tasks require completion criteria, cannot recur on a timer, and use the same execution session when explicitly resumed. Goal completion requires the durable goal complete state. Each occurrence opens an independent execution session using the current workspace, model, agent preset, and permission preset. Runs require the application to remain running; plans survive restarts. Overdue recurring intervals coalesce to one occurrence. Pausing scheduled tasks freezes the remaining wait durably; resume waits that remainder and anchors later intervals to the resumed occurrence. An explicit end time never moves; resume is rejected if the next occurrence would reach or exceed it. Pause/delete prevents future starts but does not cancel an active scheduled run. Completed means the Agent turn ended, not that tests passed. Interrupted runs may have side effects and are not automatically replayed. Times must contain an explicit UTC offset. Scheduled runs cannot create other scheduled tasks.',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'list', 'pause', 'resume', 'delete', 'history'] },
      id: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' },
      kind: { type: 'string', enum: ['goal', 'scheduled'], description: 'Use goal for explicitly requested sustained work; scheduled for reminders or periodic checks.' },
      completion_criteria: { type: 'string', description: 'Required for goal tasks: observable acceptance criteria and verification required before completion.' },
      max_goal_rounds: { type: 'integer', description: 'Goal continuation rounds per attempt, 1–100; defaults to 10.' },
      at: { type: 'string', description: 'Future RFC 3339 time with UTC offset; first occurrence for a recurring task.' },
      after_seconds: { type: 'integer', description: 'For relative requests, use exact seconds instead of calculating at: two minutes = 120. Server computes from creation time without rounding. Absolute clock times use Beijing UTC+08:00.' },
      end_at: { type: 'string', description: 'Optional RFC 3339 admission deadline after at. No new runs start at or after this time; running work continues.' },
      every_seconds: { type: 'integer', description: `Optional fixed interval, at least ${config.minEverySeconds} seconds.` },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent !== agent) throw new Error('task management requires the owning session')
      exec.signal.throwIfAborted()
      if (args.action === 'create') {
        const task = await createOwnedTask(ctx, store, agent, {
          title: args.title ?? '', prompt: args.prompt ?? '', at: args.at ?? '',
          ...(args.after_seconds === undefined ? {} : { delaySeconds: args.after_seconds }),
          ...(args.kind === undefined ? {} : { kind: args.kind }),
          ...(args.completion_criteria === undefined ? {} : { completionCriteria: args.completion_criteria }),
          ...(args.max_goal_rounds === undefined ? {} : { maxGoalRounds: args.max_goal_rounds }),
          ...(args.end_at === undefined ? {} : { endAt: args.end_at }),
          ...(args.every_seconds === undefined ? {} : { everySeconds: args.every_seconds }),
        }, config.minEverySeconds, exec.signal)
        return JSON.stringify(task)
      }
      const tasks = store.tasks().filter(task => task.ownerSessionId === agent.id)
      if (args.action === 'list') return JSON.stringify(tasks.filter(task => task.state !== 'deleted'))
      if (args.action === 'history') {
        if (args.id && !tasks.some(task => task.id === args.id)) throw new Error('task not found in this session')
        return JSON.stringify(store.runs().filter(run => tasks.some(task => task.id === run.taskId)
        && (!args.id || run.taskId === args.id)).slice(0, config.historyLimit))
      }
      if (!args.id) throw new Error('id is required')
      if (!['pause', 'resume', 'delete'].includes(args.action)) throw new Error('unsupported task action')
      return JSON.stringify(store.change(agent.id, args.id, args.action === 'pause' ? 'paused' : args.action === 'resume' ? 'active' : 'deleted'))
    },
    presentCall: args => ({ card: 'generic', title: 'Scheduled task', kind: 'other', rawInput: args }),
  }))
}
