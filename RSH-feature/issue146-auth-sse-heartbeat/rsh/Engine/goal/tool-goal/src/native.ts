/** Native model-facing Goal controls with durable current-turn authority. */
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-native-prompt'
import { HarnessError, boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution, NativeProjectedToolOutcome } from '@deepseek-ai/dsh-native-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-native-tools/json-schema'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import { GoalId, type NativeGoalOperations, type GoalView } from '@deepseek-ai/dsh-goal/native'
import { CREATE_DESCRIPTION, GET_DESCRIPTION, goalValue, guidance } from './common.ts'
import { renderWrapupContext } from './wrapup.ts'

const Configuration = z.object({ blockedAfterConsecutiveRounds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(3),
  promptOrder: z.number().default(500) }).strict()
const Create = z.object({ objective: z.string(), max_goal_rounds: z.number().optional() }).strict()
const Update = z.object({ goal_id: z.string(), revision: z.number(), action: z.enum(['edit', 'pause', 'resume', 'complete', 'blocked']),
  objective: z.string().optional(), max_goal_rounds: z.number().optional(), blocked_reason: z.string().optional() }).strict()
/** Deployment-selected model blocked threshold and prompt order. */
export type NativeGoalToolsConfig = z.infer<typeof Configuration>
/**
 * Resolve Goal tool policy.
 * @param input - profile JSON.
 * @returns validated policy.
 */
export function resolveNativeGoalToolsConfig(input: unknown): NativeGoalToolsConfig { return Configuration.parse(input ?? {}) }

const GoalOutput: JsonSchemaNode = { oneOf: [
  { type: 'object', properties: { goal: { type: 'null' } }, required: ['goal'], additionalProperties: false },
  { type: 'object', properties: { goal: { type: 'object', properties: {
    id: { type: 'string' }, revision: { type: 'integer' }, objective: { type: 'string' },
    phase: { type: 'string', enum: ['active', 'paused', 'blocked', 'complete'] }, roundsStarted: { type: 'integer' },
    maxGoalRounds: { type: 'integer' }, blockedReason: { type: 'object', properties: {
      code: { type: 'string' }, message: { type: 'string' } }, required: ['code', 'message'], additionalProperties: false },
  }, required: ['id', 'revision', 'objective', 'phase', 'roundsStarted', 'maxGoalRounds'], additionalProperties: false },
  activation: { type: 'string', enum: ['armed', 'disarmed'] } }, required: ['goal', 'activation'], additionalProperties: false },
] }

function reject(message: string, code = 'GOAL_TOOL_AUTHORITY_REQUIRED'): never { throw new HarnessError(message, code) }

async function authority(agents: NativeAgentRegistry, sessions: NativeActiveSessionOperations, goals: NativeGoalOperations,
  call: NativeToolExecution): Promise<{ direct: boolean; round: GoalView | undefined }> {
  if (agents.get(call.agent.id) !== call.agent || agents.currentInitiator() !== call.agent
    || agents.execution(call.agent).status !== 'running') reject('Goal tools require the exact active driver', 'GOAL_TOOL_DRIVER_REQUIRED')
  const owner = sessions.owner(call.agent, call.session)
  if (owner === undefined) reject('Goal tools require the selected active Session', 'GOAL_TOOL_DRIVER_REQUIRED')
  const events = await owner.readEvents()
  call.signal.throwIfAborted()
  const start = events.findLastIndex(event => event.type === 'turn/start')
  if (start < 0 || events.slice(start).some(event => event.type === 'turn/end')) {
    reject('Goal tools require an open model turn', 'GOAL_TOOL_DRIVER_REQUIRED')
  }
  const messages = events.slice(start + 1).filter(event => event.type === 'user/message').map(event => event.data)
  const direct = owner.invocation === 'root' && messages.some(message => message.source.kind === 'user')
  const goal = goals.get(call.agent)
  const round = goal !== undefined && messages.some(message => message.source.kind === 'goal'
    && message.source.goalId === goal.id && message.source.revision === goal.revision && message.source.round === goal.roundsStarted)
    ? goal : undefined
  return { direct, round }
}

function directHuman(auth: { direct: boolean }): void {
  if (!auth.direct) reject('this Goal operation requires a direct human turn on a top-level Agent')
}

/** Native Goal tools Consumer; authority derives from durable current-turn inputs and runtime invocation role. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-goal', targets: ['host'],
  requires: ['agents', 'activeSessions', 'goals', 'tools', 'promptSections'], provides: [],
  resolve(input) {
    const config = resolveNativeGoalToolsConfig(input)
    return (context) => {
      const agents = context.require('agents')
      const sessions = context.require('activeSessions')
      const goals = context.require('goals')
      const tools = context.require('tools')
      context.effect(context.require('promptSections').register({ name: 'tool:goal', order: config.promptOrder,
        text: () => guidance(config.blockedAfterConsecutiveRounds) }, context.scope))
      const output = { schema: GoalOutput, render: (_call: NativeToolExecution, value: unknown) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError: false }) }
      context.effect(tools.registerValueTool({ schema: { name: 'get_goal', description: GET_DESCRIPTION,
        parameters: { type: 'object', properties: {}, additionalProperties: false } }, output,
      execute: async (call) => { await authority(agents, sessions, goals, call); return goalValue(goals.get(call.agent)) },
      }, context.scope))
      context.effect(tools.registerValueTool({ schema: { name: 'create_goal', description: CREATE_DESCRIPTION,
        parameters: { type: 'object', properties: { objective: { type: 'string', description: 'The direct human completion objective.' },
          max_goal_rounds: { type: 'number', description: 'Optional positive safe-integer automatic round cap.' },
        },
        required: ['objective'], additionalProperties: false } }, output,
      execute: async (call) => {
        directHuman(await authority(agents, sessions, goals, call))
        const args = Create.parse(call.arguments)
        return goalValue(await goals.create(call.agent, { objective: args.objective,
          ...args.max_goal_rounds === undefined ? {} : { maxGoalRounds: args.max_goal_rounds } }))
      },
      }, context.scope))
      context.effect(tools.registerProjectedTool({ schema: { name: 'update_goal',
        description: 'Update the exact Goal revision. edit, pause and resume require a direct top-level human turn. '
          + 'complete and blocked also accept the exact autonomous Goal round. blocked requires the configured minimum round count.',
        parameters: { type: 'object', properties: { goal_id: { type: 'string' }, revision: { type: 'number' },
          action: { type: 'string', enum: ['edit', 'pause', 'resume', 'complete', 'blocked'] }, objective: { type: 'string' },
          max_goal_rounds: { type: 'number' }, blocked_reason: { type: 'string' } },
        required: ['goal_id', 'revision', 'action'], additionalProperties: false } }, output,
      execute: async (call): Promise<NativeProjectedToolOutcome> => {
        const auth = await authority(agents, sessions, goals, call)
        const args = Update.parse(call.arguments)
        if (args.goal_id.length === 0 || args.goal_id !== args.goal_id.trim()
          || !Number.isSafeInteger(args.revision) || args.revision < 1) {
          reject('goal_id and revision must identify one exact positive revision', 'GOAL_TOOL_INVALID_UPDATE')
        }
        const ref = { id: GoalId(args.goal_id), revision: args.revision }
        const hasObjective = args.objective !== undefined && args.objective !== ''
        const hasCap = args.max_goal_rounds !== undefined && args.max_goal_rounds !== 0
        const hasBlocker = args.blocked_reason !== undefined && args.blocked_reason !== ''
        if (args.action === 'edit') {
          directHuman(auth)
          if (hasBlocker) reject('blocked_reason is valid only with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
          return { value: goalValue(await goals.edit(call.agent, ref, {
            ...args.objective !== undefined && args.objective !== '' ? { objective: args.objective } : {},
            ...args.max_goal_rounds !== undefined && args.max_goal_rounds !== 0 ? { maxGoalRounds: args.max_goal_rounds } : {} })) }
        }
        if (hasObjective || hasCap) reject('objective and max_goal_rounds are valid only with action edit', 'GOAL_TOOL_INVALID_UPDATE')
        if (args.action === 'pause' || args.action === 'resume') {
          directHuman(auth)
          if (hasBlocker) reject('blocked_reason is valid only with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
          if (args.action === 'resume' && goals.get(call.agent)?.phase === 'paused') {
            reject('the model cannot resume a paused Goal; the user must resume it', 'GOAL_TOOL_RESUME_PAUSED')
          }
          return { value: goalValue(await (args.action === 'pause' ? goals.pause(call.agent, ref) : goals.resume(call.agent, ref))) }
        }
        if (!auth.direct && auth.round === undefined) reject('completion requires a direct human turn or the exact current Goal round')
        if (args.action === 'complete' && hasBlocker) reject('blocked_reason is valid only with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
        if (args.action === 'blocked' && (args.blocked_reason === undefined || args.blocked_reason.trim().length === 0)) {
          reject('blocked_reason is required with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
        }
        if (args.action === 'blocked' && !auth.direct && auth.round !== undefined
          && auth.round.roundsStarted < config.blockedAfterConsecutiveRounds) reject('blocked threshold not reached', 'GOAL_TOOL_BLOCK_THRESHOLD')
        const goal = args.action === 'complete' ? await goals.complete(call.agent, ref)
          : await goals.block(call.agent, ref, { code: 'model-reported', message: args.blocked_reason ?? '' })
        if (auth.direct || auth.round === undefined) return { value: goalValue(goal) }
        return { value: goalValue(goal), additionalContexts: [createUserMessage({
          content: renderWrapupContext(goal.objective, args.action === 'blocked' ? args.blocked_reason : undefined),
          source: { kind: 'plugin', plugin: 'tool-goal', form: 'notice', summary: boundContextSummary(`${args.action}: ${goal.objective}`) },
        })] }
      },
      }, context.scope))
    }
  },
}
