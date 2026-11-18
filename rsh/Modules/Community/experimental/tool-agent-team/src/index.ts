/** Native model-facing Team tools installed into each member's exact Agent scope. */

import { z } from 'zod'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativePromptRegistry } from '@redspark/rsh-native-prompt'
import type { NativePlugin, NativeScope } from '@redspark/rsh-native-runtime'
import type { NativeToolExecution, NativeToolRegistry } from '@redspark/rsh-native-tools'
import type { JsonSchemaNode } from '@redspark/rsh-native-tools/json-schema'
import type {} from '@redspark/rsh-native-tools/native'
import { SessionId } from '@redspark/rsh-session/native'
import {
  TeamTaskId,
  type NativeTeamService,
  type TeamMemberView,
  type TeamTaskView,
} from '@redspark/rsh-experimental-agent-team/native'

const Configuration = z.object({
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
}).strict()

/** Deployment-selected continuable-subagent providers for fresh and fork teammates. */
export type NativeTeamToolsConfig = z.infer<typeof Configuration>

/**
 * Resolve Native Team tool configuration.
 * @param input - profile JSON value.
 * @returns validated provider selection.
 */
export function resolveNativeTeamToolsConfig(input: unknown): NativeTeamToolsConfig {
  return Configuration.parse(input ?? {})
}

/** Model-facing collaboration guidance shared by Lead and teammates. */
const POLICY = `Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

send_message steers a running target at its nearest step boundary, starts an idle target, and cold-resumes an inactive teammate. A delivered peer item starts with its stable message id and sender name. A successful send is already durable even when its result says queued; do not resend it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

/**
 * One roster row, matching `TeamMemberView`. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'role', 'status', 'diagnostics'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', enum: ['lead', 'teammate'] },
    status: { type: 'string', enum: ['running', 'idle', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    diagnostics: { type: 'array', items: { type: 'string' } },
  },
}

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'revision', 'subject', 'description', 'status', 'blockedBy', 'writeScopes', 'ready', 'writeScopeWarnings'],
  properties: {
    id: { type: 'string' },
    revision: { type: 'integer' },
    subject: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', items: { type: 'string' } },
    writeScopes: { type: 'array', items: { type: 'string' } },
    ready: { type: 'boolean' },
    writeScopeWarnings: { type: 'array', items: { type: 'string' } },
  },
}

const SPAWN_VALUE_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['member'],
  properties: { member: MEMBER_VIEW_SCHEMA },
}

const MEMBER_LIST_VALUE_SCHEMA: JsonSchemaNode = { type: 'array', items: MEMBER_VIEW_SCHEMA }

const SEND_VALUE_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['messageId', 'status'],
  properties: {
    messageId: { type: 'string' },
    status: { type: 'string', enum: ['accepted', 'queued'] },
  },
}

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['timedOut'],
  properties: {
    timedOut: { type: 'boolean' },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      required: ['reason', 'message'],
      properties: {
        reason: { type: 'string', const: 'no-active-peer' },
        message: { type: 'string' },
      },
    },
  },
}

const INTERRUPT_VALUE_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['previousStatus'],
  properties: {
    previousStatus: { type: 'string', enum: ['running', 'idle', 'inactive'] },
  },
}

const TASK_LIST_VALUE_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: { type: 'array', items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
}

/**
 * Render one canonical value as compact model-facing JSON.
 * @param _call - admitted invocation, unused by fixed-record results.
 * @param value - schema-validated tool value.
 * @returns the model-visible text result.
 */
function renderJson(_call: NativeToolExecution, value: unknown): {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly isError: false
} {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }
}

/**
 * Install the complete Team tool set into one member's Agent scope.
 * @param tools - exact selected Tools registry.
 * @param prompts - exact selected prompt-section registry.
 * @param teams - selected Agent Teams runtime.
 * @param config - resolved provider selection.
 * @param agent - exact active Team member.
 * @returns awaited release of every contribution.
 */
function install(
  tools: NativeToolRegistry,
  prompts: NativePromptRegistry,
  teams: NativeTeamService,
  config: NativeTeamToolsConfig,
  agent: NativeAgent,
): () => Promise<void> {
  const scope: NativeScope = agent.scope
  const disposers: Array<() => void | Promise<void>> = []
  const register = (disposer: () => void | Promise<void>): void => { disposers.push(disposer) }
  try {
    register(prompts.register({
      name: 'team:policy',
      order: 600,
      text: () => {
        const membership = teams.tryMembership(agent)
        if (membership === undefined) return ''
        return `${POLICY}\n\nYour Team role is ${membership.role}; your Team name is ${membership.name}; Team id is ${membership.id}.`
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'spawn_teammate',
        description: 'Create one named, durable teammate. Only the Team Lead may call this tool.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'prompt'],
          properties: {
            name: { type: 'string', description: 'Unique lower-kebab-case teammate name.' },
            description: { type: 'string', description: 'Short description of the delegated responsibility.' },
            prompt: { type: 'string', description: 'Complete initial task for the teammate.' },
            context: {
              type: 'string',
              enum: ['fresh', 'fork'],
              description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
            },
          },
        },
      },
      output: { schema: SPAWN_VALUE_SCHEMA, render: renderJson },
      async execute(call) {
        const args = call.arguments as { name: string; description: string; prompt: string; context?: 'fresh' | 'fork' }
        const context = args.context ?? 'fresh'
        return await teams.spawnTeammate(call.agent, {
          name: args.name,
          description: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          signal: call.signal,
        })
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'send_message',
        description: 'Send one durable message to another Team member. A running target receives it at the nearest step boundary; an idle target starts a turn; an inactive teammate cold-resumes.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['target', 'message'],
          properties: {
            target: { type: 'string', description: 'Team member name, or lead.' },
            message: { type: 'string', description: 'Self-contained message for the target.' },
          },
        },
      },
      output: { schema: SEND_VALUE_SCHEMA, render: renderJson },
      async execute(call) {
        const args = call.arguments as { target: string; message: string }
        return await teams.sendMessage(call.agent, {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: call.signal,
        })
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'list_agents',
        description: 'List the Lead and every durable teammate with current runtime status.',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
      },
      output: { schema: MEMBER_LIST_VALUE_SCHEMA, render: renderJson },
      execute(call) {
        return Promise.resolve(teams.listMembers(call.agent))
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'wait_agent',
        description: 'Wait for the next teammate status, mailbox, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            timeout_ms: {
              type: 'integer',
              description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
            },
          },
        },
      },
      output: { schema: WAIT_VALUE_SCHEMA, render: renderJson },
      async execute(call) {
        const args = call.arguments as { timeout_ms?: number }
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve the Team service's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await teams.waitForChange(call.agent, timeoutMs, call.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = teams.listMembers(call.agent).some(member =>
          member.id !== SessionId(call.agent.id) && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: { reason: 'no-active-peer' as const, message: NO_ACTIVE_PEER_MESSAGE },
          }
        }
        return await teams.waitForChange(call.agent, timeoutMs, call.signal)
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'interrupt_agent',
        description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['target'],
          properties: { target: { type: 'string', description: 'Teammate name.' } },
        },
      },
      output: { schema: INTERRUPT_VALUE_SCHEMA, render: renderJson },
      execute(call) {
        const args = call.arguments as { target: string }
        return Promise.resolve(teams.interrupt(call.agent, args.target))
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'team_task_create',
        description: 'Create one unowned pending task on the shared Team task board.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['subject', 'description'],
          properties: {
            subject: { type: 'string', description: 'Concise task title.' },
            description: { type: 'string', description: 'Complete task details and acceptance criteria.' },
            blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
            write_scopes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
            },
          },
        },
      },
      output: { schema: TASK_VIEW_SCHEMA, render: renderJson },
      async execute(call) {
        const args = call.arguments as {
          subject: string
          description: string
          blocked_by?: string[]
          write_scopes?: string[]
        }
        return await teams.createTask(call.agent, {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'team_task_list',
        description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Optional exact status filter.',
            },
            owner: { type: 'string', description: 'Optional member-name filter; use unowned for tasks without an owner.' },
            ready: { type: 'boolean', description: 'Optional readiness filter.' },
            cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
            limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
          },
        },
      },
      output: { schema: TASK_LIST_VALUE_SCHEMA, render: renderJson },
      execute(call) {
        const args = call.arguments as {
          status?: TeamTaskView['status']
          owner?: string
          ready?: boolean
          cursor?: number
          limit?: number
        }
        const status = args.status
        const filtered = teams.listTasks(call.agent).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'team_task_get',
        description: 'Read the complete latest value of one shared task before changing or executing it.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['task_id'],
          properties: { task_id: { type: 'string', description: 'Shared task id.' } },
        },
      },
      output: { schema: TASK_VIEW_SCHEMA, render: renderJson },
      execute(call) {
        const args = call.arguments as { task_id: string }
        return Promise.resolve(teams.getTask(call.agent, TeamTaskId(args.task_id)))
      },
    }, scope))

    register(tools.registerValueTool({
      schema: {
        name: 'team_task_update',
        description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['task_id', 'expected_revision', 'action'],
          properties: {
            task_id: { type: 'string', description: 'Shared task id.' },
            expected_revision: { type: 'integer', description: 'Current task revision used as the CAS precondition.' },
            action: {
              type: 'string',
              enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
              description: 'Task transition to apply.',
            },
            subject: { type: 'string', description: 'Replacement title for edit.' },
            description: { type: 'string', description: 'Replacement details for edit.' },
            blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
            write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
            owner: { type: 'string', description: 'Member name for Lead-only reassign; omit to unassign.' },
          },
        },
      },
      output: { schema: TASK_VIEW_SCHEMA, render: renderJson },
      async execute(call) {
        const args = call.arguments as {
          task_id: string
          expected_revision: number
          action: 'claim' | 'release' | 'edit' | 'set_dependencies' | 'complete' | 'reopen' | 'reassign' | 'delete'
          subject?: string
          description?: string
          blocked_by?: string[]
          write_scopes?: string[]
          owner?: string
        }
        return await teams.updateTask(call.agent, {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    }, scope))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}

/** Install Team tools in every attached Team member scope and remove them on disposal. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-experimental-tool-agent-team',
  targets: ['host'],
  requires: ['agentTeams', 'agents', 'activeSessions', 'tools', 'promptSections'],
  optional: [],
  provides: [],
  resolve(input) {
    const config = resolveNativeTeamToolsConfig(input)
    return (context) => {
      const teams = context.require('agentTeams')
      const agents = context.require('agents')
      const active = context.require('activeSessions')
      const tools = context.require('tools')
      const prompts = context.require('promptSections')
      const installed = new Map<NativeAgent, () => Promise<void>>()
      const maybeInstall = (agent: NativeAgent): void => {
        if (installed.has(agent) || teams.tryMembership(agent) === undefined) return
        const dispose = install(tools, prompts, teams, config, agent)
        installed.set(agent, dispose)
        agents.onDispose(agent, dispose)
      }
      context.effect(active.onAttached((owner) => {
        maybeInstall(owner.agent)
        return Promise.resolve()
      }))
      for (const owner of active.owners()) maybeInstall(owner.agent)
      // A Team member whose owner attaches before this plugin activates still
      // arrives through the initial owner pass; later members attach after
      // registration, so the event is only a fallback for already-attached Agents.
      context.effect(context.on('agent/created', (agent) => { maybeInstall(agent) }))
      context.effect(async () => {
        for (const dispose of [...installed.values()].reverse()) await dispose()
        installed.clear()
      })
    }
  },
}

export default plugin
