/** Native Team membership, continuable-child provisioning, and roster teardown. */

import { randomUUID } from 'node:crypto'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@redspark/rsh-native-agent'
import type { NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import { SessionId } from '@redspark/rsh-session/native'
import type { NativeSubagentOperations } from '@redspark/rsh-native-subagent'
import { foldSubagentDescriptor } from '@redspark/rsh-subagent-protocol/descriptor'
import { errorMessage, TeamError } from './error.ts'
import type { TeamJournalPort } from './journal-port.ts'
import type { TeamRuntimeLifecycle } from './lifecycle.ts'
import type { TeamCallerMembership } from './membership.ts'
import { resolveActiveMember } from './membership.ts'
import type { NativeTeamRoot } from './native-journal.ts'
import { readPersistedSession } from './persisted.ts'
import { messageAccepted } from './session-message.ts'
import { TeamId } from './types.ts'
import type { SpawnTeammateRequest, SpawnTeammateResult, TeamMemberSnapshot, TeamMemberView } from './types.ts'
import { requiredText } from './validation.ts'

const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Services and exact-owner routing the Native roster reads. */
export interface NativeTeamRosterDeps {
  readonly agents: NativeAgentRegistry
  readonly subagents: NativeSubagentOperations
  readonly persistence: NativeSessionPersistenceOperations
  readonly journal: TeamJournalPort<NativeTeamRoot>
  readonly lifecycle: TeamRuntimeLifecycle
  readonly maxMembers: number
  readonly maxDepth: number
  /** @param agent - exact live Agent to resolve. @returns its retained owner, or undefined when detached. */
  ownerOf(agent: NativeAgent): NativeActiveSessionOwner | undefined
  /** @param agent - exact live Agent to resolve. @returns its root identity, or undefined when detached. */
  rootOf(agent: NativeAgent): NativeTeamRoot | undefined
  /** @param owner - exact active Session owner. @returns whether its Program is executing a turn. */
  statusOf(owner: NativeActiveSessionOwner): 'running' | 'idle'
}

/** Owns Native Team identities and the lifecycle of rostered continuable children. */
export class NativeTeamRoster {
  private readonly inFlightCreations = new Set<Promise<unknown>>()

  /** @param deps - exact live Agent, subagent, persistence and journal owners. */
  constructor(private readonly deps: NativeTeamRosterDeps) {}

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: NativeAgent): TeamCallerMembership<NativeTeamRoot> {
    const membership = this.tryMembership(agent)
    if (membership === undefined) {
      throw new TeamError(`agent "${agent.id}" is not a member of an active Agent Team`, 'TEAM_NOT_MEMBER')
    }
    return membership
  }

  /**
   * Resolve a caller without throwing for scoped installation and lifecycle observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: NativeAgent): TeamCallerMembership<NativeTeamRoot> | undefined {
    const owner = this.deps.ownerOf(agent)
    if (owner === undefined || this.deps.agents.get(agent.id) !== agent) return undefined
    try {
      const parentId = owner.session.header.parentSession
      if (parentId !== undefined) {
        const rootAgent = this.deps.agents.get(NativeAgentId(parentId))
        const root = rootAgent === undefined ? undefined : this.deps.rootOf(rootAgent)
        if (root !== undefined) {
          const member = this.deps.journal.state(root).members.find(candidate => candidate.id === SessionId(agent.id))
          if (member?.phase === 'active' || member?.phase === 'provisioning') {
            return { root, id: TeamId(root.id), role: 'teammate', name: member.name }
          }
          // A direct child outside the durable roster is not a teammate. Ordinary
          // host forks are independent roots; subagent descriptors distinguish
          // provider-owned workers that must not receive a nested Team identity.
          if (this.subagentDescriptor(owner)) return undefined
          const ownRoot = this.deps.rootOf(agent)
          if (ownRoot !== undefined) return { root: ownRoot, id: TeamId(ownRoot.id), role: 'lead', name: 'lead' }
          return undefined
        }
      }
      // A continuation can briefly outlive its parent during child-first teardown.
      // Do not reinterpret that durable child as a new implicit root Team.
      if (this.subagentDescriptor(owner)) return undefined
      const root = this.deps.rootOf(agent)
      return root === undefined ? undefined : { root, id: TeamId(root.id), role: 'lead', name: 'lead' }
    } catch {
      // This method is used by lifecycle observers and teardown discovery. A
      // malformed durable stream is surfaced by authoritative Team operations;
      // the non-throwing probe must not veto unrelated Agent lifecycle edges.
      return undefined
    }
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param membership - exact caller membership resolved by this roster.
   * @returns Lead and teammate rows in creation order.
   */
  list(membership: TeamCallerMembership<NativeTeamRoot>): TeamMemberView[] {
    const { root } = membership
    const state = this.deps.journal.state(root)
    const rootOwner = this.deps.ownerOf(root.agent)
    const rootModel = rootOwner?.session.requestHeader()?.config.model
    const result: TeamMemberView[] = [{
      id: root.id,
      name: 'lead',
      role: 'lead',
      status: rootOwner === undefined ? 'inactive' : this.deps.statusOf(rootOwner),
      ...rootModel === undefined ? {} : { model: rootModel },
      diagnostics: [],
    }]
    for (const member of state.members) {
      const agent = this.deps.agents.get(NativeAgentId(member.id))
      const owner = agent === undefined ? undefined : this.deps.ownerOf(agent)
      const model = owner?.session.requestHeader()?.config.model ?? rootModel
      result.push({
        id: member.id,
        name: member.name,
        role: 'teammate',
        status: member.phase === 'failed'
          ? 'failed'
          : member.phase === 'provisioning'
            ? 'provisioning'
            : owner === undefined ? 'inactive' : this.deps.statusOf(owner),
        description: member.description,
        provider: member.provider,
        context: member.context,
        ...model === undefined ? {} : { model },
        diagnostics: member.error === undefined ? [] : [member.error],
      })
    }
    return result
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawn(caller: NativeAgent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    if (this.deps.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    const operation = this.spawnAdmitted(caller, request)
    this.inFlightCreations.add(operation)
    try {
      return await operation
    } finally {
      this.inFlightCreations.delete(operation)
    }
  }

  /**
   * Return admitted creation operations captured for ordered disposal.
   * @returns detached snapshot ordered only by Set insertion.
   */
  pendingCreations(): readonly Promise<unknown>[] {
    return [...this.inFlightCreations]
  }

  /**
   * Reconcile provisioning state when one Team member Session starts.
   * @param agent - newly started exact live Agent.
   * @param signal - shared runtime cancellation.
   */
  async recoverFor(agent: NativeAgent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const membership = this.tryMembership(agent)
    if (membership?.role === 'lead') await this.reconcileProvisioning(membership.root, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: NativeAgent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can interrupt teammates', 'TEAM_LEAD_REQUIRED')
    const state = this.deps.journal.state(membership.root)
    const target = resolveActiveMember(membership.root, state, targetName)
    if (target.id === membership.root.id) {
      throw new TeamError('the Team Lead cannot interrupt itself', 'TEAM_INVALID_TARGET')
    }
    const agent = this.deps.agents.get(NativeAgentId(target.id))
    const owner = agent === undefined ? undefined : this.deps.ownerOf(agent)
    if (agent === undefined || owner === undefined) return { previousStatus: 'inactive' }
    const previousStatus = this.deps.statusOf(owner)
    const callerRoot = this.deps.rootOf(caller)
    if (callerRoot === undefined) throw new TeamError('the Team Lead is no longer active', 'TEAM_NOT_ACTIVE')
    this.deps.subagents.interrupt({ agent: caller, session: callerRoot.session, target: target.id })
    return { previousStatus }
  }

  /**
   * Group exact live roster children by their current Lead for runtime teardown.
   * @returns each live Lead and the roster child ids currently in the Agent registry.
   */
  liveChildrenByRoot(): Map<NativeTeamRoot, SessionId[]> {
    const teams = new Map<NativeTeamRoot, SessionId[]>()
    for (const agent of this.deps.agents.list()) {
      const owner = this.deps.ownerOf(agent)
      if (owner === undefined || owner.session.header.parentSession === undefined) continue
      const membership = this.tryMembership(agent)
      if (membership?.role !== 'teammate') continue
      const children = teams.get(membership.root) ?? []
      children.push(SessionId(agent.id))
      teams.set(membership.root, children)
    }
    return teams
  }

  /**
   * Interrupt selected live roster children.
   * Program owner teardown releases their writers and resources; this roster only
   * stops turns that would otherwise keep executing while the service disposes.
   * @param root - exact live Team Lead authorizing interruption.
   * @param childIds - selected roster child ids.
   */
  stopTeammates(root: NativeTeamRoot, childIds: readonly SessionId[]): Promise<void> {
    for (const id of childIds) {
      if (this.deps.agents.get(NativeAgentId(id)) === undefined) continue
      this.deps.subagents.interrupt({ agent: root.agent, session: root.session, target: id })
    }
    return Promise.resolve()
  }

  /** Perform one creation admitted before the Team runtime disposal cutoff. */
  private async spawnAdmitted(caller: NativeAgent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can create teammates', 'TEAM_LEAD_REQUIRED')
    }
    const signal = AbortSignal.any([request.signal, this.deps.lifecycle.signal])
    signal.throwIfAborted()
    const root = membership.root
    const name = this.memberName(request.name)
    const description = requiredText(request.description, 'description', 200)
    const childId = SessionId(randomUUID())
    const member: TeamMemberSnapshot = {
      id: childId,
      name,
      description,
      provider: requiredText(request.provider, 'provider', 200),
      context: request.context,
      phase: 'provisioning',
    }
    await this.deps.journal.transact(root.id, async () => {
      const state = this.deps.journal.state(root)
      if (state.members.some(candidate => candidate.name === name)) {
        throw new TeamError(`teammate name "${name}" was already used in this Team`, 'TEAM_MEMBER_NAME_TAKEN')
      }
      if (state.members.length >= this.deps.maxMembers) {
        throw new TeamError(`Team member limit ${this.deps.maxMembers} reached`, 'TEAM_MEMBER_LIMIT')
      }
      await this.deps.journal.appendAndFlush(root, 'team/member', {
        version: 2,
        teamId: TeamId(root.id),
        member,
      })
    })
    try {
      const resolved = this.deps.subagents.resolve({
        agent: root.agent,
        session: root.session,
        label: description,
        prompt: request.prompt,
        options: {
          maxDepth: this.deps.maxDepth,
          ...request.context === 'fork' ? { inheritCompletedTurns: true } : {},
        },
      })
      const started = await this.deps.subagents.startContinuable({ ...resolved, id: childId }, signal)
      if (started.id !== childId) {
        throw new TeamError(
          `teammate "${name}" was created as "${started.id}" instead of its reserved identity`,
          'TEAM_PROVISIONING_CONFLICT',
        )
      }
      // A resolved startContinuable has already flushed the initial inbox item,
      // so the child's durable acceptance is established before `active`.
    } catch (error: unknown) {
      const failed: TeamMemberSnapshot = { ...member, phase: 'failed', error: errorMessage(error) }
      try {
        const phase = await this.settleProvisioning(root, failed)
        await this.stopTeammates(root, [childId])
        if (phase === 'active') {
          throw new TeamError(
            `teammate "${name}" became active while its creator reported failure`,
            'TEAM_PROVISIONING_CONFLICT',
            { cause: error },
          )
        }
      } catch (recordError: unknown) {
        throw new AggregateError([error, recordError], 'teammate creation and durable failure recording both failed')
      }
      throw error
    }
    const active = { ...member, phase: 'active' as const } satisfies TeamMemberSnapshot
    const settledPhase = await this.settleProvisioning(root, active)
    if (settledPhase === 'failed') {
      const conflict = new TeamError(
        `teammate "${name}" was reconciled as failed while creation was in progress`,
        'TEAM_PROVISIONING_CONFLICT',
      )
      try {
        await this.stopTeammates(root, [childId])
      } catch (cleanupError: unknown) {
        throw new AggregateError([conflict, cleanupError], 'provisioning conflict cleanup failed')
      }
      throw conflict
    }
    return { member: this.memberView(active) }
  }

  /** Settle provisioning-only members from their independently durable child Sessions. */
  private async reconcileProvisioning(root: NativeTeamRoot, signal: AbortSignal): Promise<void> {
    const provisioning = this.deps.journal.state(root).members.filter(member => member.phase === 'provisioning')
    for (const member of provisioning) {
      signal.throwIfAborted()
      // A live child means creation is still completing in this process. Its
      // creator owns the terminal member edge.
      if (this.deps.agents.get(NativeAgentId(member.id)) !== undefined) continue
      let phase: 'active' | 'failed' = 'failed'
      let failure = 'provisioning did not leave a resumable child Session'
      try {
        const loaded = await readPersistedSession(this.deps.persistence, member.id, signal)
        const suffix = loaded.events.slice(loaded.inheritedEventCount)
        const descriptor = foldSubagentDescriptor(suffix)
        const acceptedInitialPrompt = messageAccepted(suffix, message => message.source.kind === 'user')
        if (loaded.header.parentSession === root.id
          && descriptor?.mode === 'continuable'
          && descriptor.provider === this.deps.subagents.providerName
          && acceptedInitialPrompt) {
          phase = 'active'
        } else {
          failure = 'persisted child Session does not match the provisioned continuation'
        }
      } catch (error: unknown) {
        failure = `child Session recovery failed: ${errorMessage(error)}`
      }
      signal.throwIfAborted()
      await this.deps.journal.transact(root.id, async () => {
        signal.throwIfAborted()
        const current = this.deps.journal.state(root).members.find(candidate => candidate.id === member.id)
        if (current?.phase !== 'provisioning') return
        const settled: TeamMemberSnapshot = {
          ...current,
          phase,
          ...phase === 'failed' ? { error: failure } : {},
        }
        await this.deps.journal.appendAndFlush(root, 'team/member', {
          version: 2,
          teamId: TeamId(root.id),
          member: settled,
        })
      })
    }
  }

  /** Build one runtime member row after successful creation. */
  private memberView(member: TeamMemberSnapshot & { readonly phase: 'active' }): TeamMemberView {
    const agent = this.deps.agents.get(NativeAgentId(member.id))
    const owner = agent === undefined ? undefined : this.deps.ownerOf(agent)
    const model = owner?.session.requestHeader()?.config.model
    return {
      id: member.id,
      name: member.name,
      role: 'teammate',
      status: owner === undefined ? 'provisioning' : this.deps.statusOf(owner),
      description: member.description,
      provider: member.provider,
      context: member.context,
      ...model === undefined ? {} : { model },
      diagnostics: [],
    }
  }

  /** Validate a never-reused model-facing teammate name. */
  private memberName(value: string): string {
    if (!MEMBER_NAME.test(value) || value.length > 64 || value === 'lead') {
      throw new TeamError(
        'teammate name must be lower-kebab-case, at most 64 characters, and not "lead"',
        'TEAM_INVALID_MEMBER_NAME',
      )
    }
    return value
  }

  /** Append one terminal provisioning edge unless recovery already settled it. */
  private async settleProvisioning(
    root: NativeTeamRoot,
    terminal: TeamMemberSnapshot,
  ): Promise<'active' | 'failed'> {
    return this.deps.journal.transact(root.id, async () => {
      const current = this.deps.journal.state(root).members.find(member => member.id === terminal.id)
      if (current === undefined) {
        throw new TeamError(`provisioned teammate "${terminal.id}" disappeared`, 'TEAM_PROVISIONING_CONFLICT')
      }
      if (current.phase !== 'provisioning') return current.phase
      await this.deps.journal.appendAndFlush(root, 'team/member', {
        version: 2,
        teamId: TeamId(root.id),
        member: terminal,
      })
      return terminal.phase === 'active' ? 'active' : 'failed'
    })
  }

  /** Whether a Session's own suffix identifies a provider-owned subagent child. */
  private subagentDescriptor(owner: NativeActiveSessionOwner): boolean {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    return foldSubagentDescriptor(owner.session.snapshotEvents(owner.session.inheritedEventCount)) !== undefined
  }
}
