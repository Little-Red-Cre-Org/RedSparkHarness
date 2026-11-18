/** Native Agent Teams service over the selected Program's exact active Session writers. */

import { type NativeAgent, type NativeAgentRegistry } from '@redspark/rsh-native-agent'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import type { NativeSessionProjectionOperations } from '@redspark/rsh-session-projection/native'
import { SessionId } from '@redspark/rsh-session/native'
import type { NativeSubagentOperations } from '@redspark/rsh-native-subagent'
import { TeamActivity } from './activity.ts'
import { errorMessage, TeamError } from './error.ts'
import { teamProjectionDefinition } from './projection.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamId, type TeamTaskId } from './types.ts'
import { NativeTeamJournal, type NativeTeamRoot } from './native-journal.ts'
import { NativeTeamRoster } from './native-roster.ts'
import { NativeTeamMailbox } from './native-mailbox.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamTaskMutationResult,
  TeamTaskView,
  TeamWaitResult,
  UpdateTeamTaskRequest,
} from './types.ts'
import type { TeamCallerMembership } from './membership.ts'

export type * from './types.ts'
export type { TeamCallerMembership } from './membership.ts'
export type { NativeTeamRoot } from './native-journal.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    agentTeams: NativeTeamService
  }
}

const DEFAULT_MAX_MEMBERS = 8
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_PENDING_MESSAGES = 64
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
const DEFAULT_MAX_DEPTH = 3

/** Resolved Native Agent Teams deployment limits. */
export type NativeTeamConfig = Required<Config> & { readonly maxDepth: number }

/**
 * Validate Native Agent Teams deployment configuration.
 * @param input - profile JSON value.
 * @returns every limit with its deployment default.
 * @throws {TeamError} when a field is unknown or out of range.
 */
export function resolveNativeTeamConfig(input?: unknown): NativeTeamConfig {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TeamError('Agent Teams configuration must be an object', 'TEAM_INVALID_CONFIG')
  }
  const fields = (input ?? {}) as Record<string, unknown>
  const permitted = [
    'maxMembers', 'maxTasks', 'maxPendingMessagesPerMember',
    'maxMessageBytes', 'disposalTimeoutMs', 'maxDepth',
  ] as const
  for (const key of Object.keys(fields)) {
    if (!permitted.includes(key as typeof permitted[number])) {
      throw new TeamError(`unknown Agent Teams configuration field ${key}`, 'TEAM_INVALID_CONFIG')
    }
  }
  const limit = (name: typeof permitted[number], fallback: number): number => {
    const value = fields[name] ?? fallback
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
    }
    return value
  }
  return {
    maxMembers: limit('maxMembers', DEFAULT_MAX_MEMBERS),
    maxTasks: limit('maxTasks', DEFAULT_MAX_TASKS),
    maxPendingMessagesPerMember: limit('maxPendingMessagesPerMember', DEFAULT_MAX_PENDING_MESSAGES),
    maxMessageBytes: limit('maxMessageBytes', DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: limit('disposalTimeoutMs', DEFAULT_DISPOSAL_TIMEOUT_MS),
    maxDepth: limit('maxDepth', DEFAULT_MAX_DEPTH),
  }
}

/** Exact services a Native Team runtime reads. */
export interface NativeTeamDeps {
  readonly agents: NativeAgentRegistry
  readonly active: NativeActiveSessionOperations
  readonly projections: NativeSessionProjectionOperations
  readonly persistence: NativeSessionPersistenceOperations
  readonly subagents: NativeSubagentOperations
}

/** Agent Teams service backed by the exact live Lead Session writers. */
export class NativeTeamService {
  private readonly owners = new Map<SessionId, NativeActiveSessionOwner>()
  private readonly stops = new Map<SessionId, () => void>()
  private readonly running = new Set<SessionId>()
  private readonly activity = new TeamActivity()
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: NativeTeamJournal
  private readonly roster: NativeTeamRoster
  private readonly mailbox: NativeTeamMailbox
  private readonly tasks: TeamTaskBoard<NativeTeamRoot>
  private disposal: Promise<void> | undefined

  /**
   * @param deps - exact live Agent, owner, projection, persistence and subagent services.
   * @param config - validated deployment limits.
   */
  constructor(
    private readonly deps: NativeTeamDeps,
    private readonly config: NativeTeamConfig,
  ) {
    this.lifecycle = new TeamRuntimeLifecycle(config.disposalTimeoutMs)
    this.journal = new NativeTeamJournal(deps.active, deps.projections, (root) => {
      this.activity.notify(TeamId(root.id))
    })
    this.roster = new NativeTeamRoster({
      agents: deps.agents,
      subagents: deps.subagents,
      persistence: deps.persistence,
      journal: this.journal,
      lifecycle: this.lifecycle,
      maxMembers: config.maxMembers,
      maxDepth: config.maxDepth,
      ownerOf: agent => this.ownerOf(agent),
      rootOf: agent => this.rootOf(agent),
      statusOf: owner => this.statusOf(owner),
    })
    this.mailbox = new NativeTeamMailbox({
      subagents: deps.subagents,
      persistence: deps.persistence,
      journal: this.journal,
      roster: this.roster,
      lifecycle: this.lifecycle,
      maxPendingMessagesPerMember: config.maxPendingMessagesPerMember,
      maxMessageBytes: config.maxMessageBytes,
      ownerOfSession: id => this.owners.get(id),
      warn: (message) => { console.warn(message) },
    })
    this.tasks = new TeamTaskBoard(this.journal, config.maxTasks)
  }

  /**
   * Read every limit resolved for this installation.
   * @returns detached deployment configuration.
   */
  configuration(): NativeTeamConfig {
    return { ...this.config }
  }

  /**
   * Start observing one exact active Session owner.
   * @param owner - newly attached owner.
   */
  attach(owner: NativeActiveSessionOwner): void {
    if (this.lifecycle.disposed || this.owners.has(owner.session.id)) return
    this.owners.set(owner.session.id, owner)
    this.stops.set(owner.session.id, owner.onEvent((event) => {
      if (event.type === 'turn/start') this.running.add(owner.session.id)
      else if (event.type === 'turn/end') this.running.delete(owner.session.id)
      this.mailbox.observeSessionEvent(owner, event)
    }))
    this.scheduleRecovery(owner.agent)
  }

  /**
   * Stop observing one detached owner.
   * @param owner - owner whose retention ended.
   */
  detach(owner: NativeActiveSessionOwner): void {
    const stop = this.stops.get(owner.session.id)
    this.stops.delete(owner.session.id)
    this.owners.delete(owner.session.id)
    this.running.delete(owner.session.id)
    stop?.()
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: NativeAgent): TeamCallerMembership<NativeTeamRoot> {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: NativeAgent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: NativeAgent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    return await this.roster.spawn(caller, request)
  }

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async sendMessage(caller: NativeAgent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    return await this.mailbox.send(caller, request)
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: NativeAgent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: NativeAgent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: NativeAgent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: NativeAgent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update({ id: SessionId(caller.id) }, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: NativeAgent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: NativeAgent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: NativeAgent): TeamCallerMembership<NativeTeamRoot> | undefined {
    return this.roster.tryMembership(agent)
  }

  /**
   * Create one shared task and preserve Team rejections as business results.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task or a typed Team rejection.
   */
  async createTaskResult(caller: NativeAgent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return await this.taskMutationResult(this.createTask(caller, request))
  }

  /**
   * Apply one task mutation and preserve Team rejections as business results.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed task or a typed Team rejection.
   */
  async updateTaskResult(caller: NativeAgent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return await this.taskMutationResult(this.updateTask(caller, request))
  }

  /**
   * Read the current roster and non-deleted task board.
   * @param caller - exact live Team member used as the authority credential.
   * @returns detached current roster and task views.
   */
  view(caller: NativeAgent): { readonly members: TeamMemberView[]; readonly tasks: TeamTaskView[] } {
    return { members: this.listMembers(caller), tasks: this.listTasks(caller) }
  }

  /**
   * Release every Team-owned runtime resource.
   * @returns completion after admitted creation and dispatch work settles.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposal = this.disposeRuntime()
    return this.disposal
  }

  /** Resolve the retained owner of one exact live Agent. */
  private ownerOf(agent: NativeAgent): NativeActiveSessionOwner | undefined {
    const owner = this.owners.get(SessionId(agent.id))
    if (owner === undefined || this.deps.agents.get(agent.id) !== agent) return undefined
    return owner
  }

  /** Build the exact root identity for one live Agent. */
  private rootOf(agent: NativeAgent): NativeTeamRoot | undefined {
    const owner = this.ownerOf(agent)
    return owner === undefined ? undefined : { id: owner.session.id, agent: owner.agent, session: owner.session }
  }

  /** Map one owner to its execution status inside this process. */
  private statusOf(owner: NativeActiveSessionOwner): 'running' | 'idle' {
    return this.running.has(owner.session.id) ? 'running' : 'idle'
  }

  /** Preserve Team task rejections while allowing unexpected failures to reject the call. */
  private async taskMutationResult(operation: Promise<TeamTaskView>): Promise<TeamTaskMutationResult> {
    try {
      return { ok: true, value: await operation }
    } catch (error) {
      if (!(error instanceof TeamError)) throw error
      return {
        ok: false,
        error: {
          code: error.code === 'TEAM_TASK_STALE_REVISION' ? 'team-task-conflict' : 'team-rejected',
          message: error.message,
        },
      }
    }
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: NativeAgent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        console.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile roster provisioning before retrying that member's pending mailbox. */
  private async recoverFor(agent: NativeAgent): Promise<void> {
    await this.roster.recoverFor(agent, this.lifecycle.signal)
    await this.mailbox.recoverFor(agent, this.lifecycle.signal)
  }

  /** Stop Team-owned work and release every waiter before disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()
    const failures: unknown[] = []
    await this.lifecycle.settle(this.roster.pendingCreations(), failures)
    await this.lifecycle.settle(this.mailbox.pendingDispatches(), failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    for (const stop of this.stops.values()) stop()
    this.stops.clear()
    this.owners.clear()
    this.running.clear()
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

/** Selected Native Agent Teams Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-experimental-agent-team',
  targets: ['host'],
  requires: ['agents', 'activeSessions', 'sessionPersistence', 'sessionProjections', 'subagents'],
  optional: [],
  provides: ['agentTeams'],
  resolve(input) {
    const config = resolveNativeTeamConfig(input)
    return (context) => {
      const deps: NativeTeamDeps = {
        agents: context.require('agents'),
        active: context.require('activeSessions'),
        projections: context.require('sessionProjections'),
        persistence: context.require('sessionPersistence'),
        subagents: context.require('subagents'),
      }
      const service = new NativeTeamService(deps, config)
      context.effect(deps.projections.register(teamProjectionDefinition))
      context.effect(deps.active.onAttached((owner) => {
        service.attach(owner)
        return Promise.resolve()
      }))
      context.effect(deps.active.onDetached((owner) => {
        service.detach(owner)
        return Promise.resolve()
      }))
      for (const owner of deps.active.owners()) service.attach(owner)
      context.provide('agentTeams', service)
      context.own(() => service.dispose())
    }
  },
}

export default plugin
