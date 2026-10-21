/** Shared admission used by the model tool and the human-facing GUI. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { TaskStore } from './store.ts'
import type { Task } from './types.ts'
import type { CreateTaskRequest } from './gui-types.ts'
import { delayedTime, reminderDuration, validateTimingDescription } from './time.ts'

/**
 * Capture the selected root session's existing execution configuration and persist a plan.
 * @param ctx - Host providing preset and permission services.
 * @param store - Durable plan authority.
 * @param agent - Creating root Agent.
 * @param input - User-authored schedule.
 * @param minimum - Minimum fixed period in seconds.
 * @param signal - Operation cancellation, when provided by a tool invocation.
 * @returns The durably created plan.
 */
export async function createOwnedTask(ctx: Context, store: TaskStore, agent: Agent, input: CreateTaskRequest,
  minimum: number, signal?: AbortSignal): Promise<Task> {
  if (agent.id.startsWith('scheduled-') || !ctx.agents.roots().includes(agent)) throw new Error('Only a normal root session can create tasks')
  const selected = agent.session.requestHeader()
  const provider = selected?.config.provider ?? agent.options.provider
  const model = selected?.config.model ?? agent.options.model
  const workspace = agent.session.header.cwd
  if (!provider || !model || !workspace) throw new Error('Select a workspace and model before scheduling')
  const preset = await ctx.agentPresets.resolve(agent.session.header.agentPreset)
  const permissionPreset = ctx.permissionPresets.current(agent.session)
  ctx.permissionPresets.resolve(permissionPreset)
  signal?.throwIfAborted()
  const now = Date.now()
  validateTimingDescription(input, now)
  const { delaySeconds, delayFromAt, ...plan } = input
  const countdown = delaySeconds === undefined ? undefined : delayFromAt ? Date.parse(plan.at) : now
  if (countdown !== undefined && (!Number.isFinite(countdown) || countdown < now)) throw new Error('Countdown start must not be in the past')
  if (delaySeconds !== undefined && countdown !== undefined) plan.at = delayedTime(delaySeconds, countdown)
  const duration = reminderDuration(plan.prompt)
  if (duration !== undefined && countdown !== undefined && plan.everySeconds !== undefined) {
    plan.endAt = new Date(countdown + duration * 1000).toISOString()
  }
  return store.create(agent.id, { ...plan,
    ...(countdown === undefined ? {} : { countdownStartedAt: new Date(countdown).toISOString() }),
    workspace, provider, model, agentPreset: preset.id, permissionPreset }, now, minimum)
}
