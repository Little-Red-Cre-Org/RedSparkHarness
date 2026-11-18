/** Native Team mailbox admission, target-local dispatch, acknowledgement, and recovery. */

import { randomUUID } from 'node:crypto'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import { createUserMessage, type ContentBlock } from '@redspark/rsh-llm/native'
import { SessionId, type Session, type SessionEvent } from '@redspark/rsh-session/native'
import type { NativeSubagentOperations } from '@redspark/rsh-native-subagent'
import { errorMessage, TeamError } from './error.ts'
import type { TeamJournalPort } from './journal-port.ts'
import type { TeamRuntimeLifecycle } from './lifecycle.ts'
import type { NativeTeamRoot } from './native-journal.ts'
import type { NativeTeamRoster } from './native-roster.ts'
import { readPersistedSession } from './persisted.ts'
import { resolveActiveMember } from './membership.ts'
import { messageAccepted } from './session-message.ts'
import { TeamId, TeamMessageId } from './types.ts'
import type { SendTeamMessageRequest, SendTeamMessageResult, TeamMessageSnapshot } from './types.ts'

/** Services and exact-owner routing the Native mailbox reads. */
export interface NativeTeamMailboxDeps {
  readonly subagents: NativeSubagentOperations
  readonly persistence: NativeSessionPersistenceOperations
  readonly journal: TeamJournalPort<NativeTeamRoot>
  readonly roster: NativeTeamRoster
  readonly lifecycle: TeamRuntimeLifecycle
  readonly maxPendingMessagesPerMember: number
  readonly maxMessageBytes: number
  /** @param id - durable Session or Agent identity. @returns its retained owner, or undefined when detached. */
  ownerOfSession(id: SessionId): NativeActiveSessionOwner | undefined
  /** @param message - contained recovery warning. */
  warn(message: string): void
}

/** Owns every process-local state transition for the durable Native Team mailbox. */
export class NativeTeamMailbox {
  private readonly dispatchTails = new Map<SessionId, Promise<void>>()
  private readonly inFlightMessages = new Set<TeamMessageId>()
  private readonly inFlightDispatches = new Set<Promise<unknown>>()

  /** @param deps - exact journal, roster, subagent, persistence and lifecycle owners. */
  constructor(private readonly deps: NativeTeamMailboxDeps) {}

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async send(caller: NativeAgent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    if (this.deps.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    const operation = this.sendAdmitted(caller, {
      ...request,
      signal: AbortSignal.any([request.signal, this.deps.lifecycle.signal]),
    })
    return await this.trackDispatch(operation)
  }

  /**
   * Observe target-side durable receipts and checkpoint their Lead-log acknowledgement.
   * @param owner - exact target Session owner receiving the committed event.
   * @param event - newly committed Session event.
   */
  observeSessionEvent(owner: NativeActiveSessionOwner, event: SessionEvent): void {
    if (this.deps.lifecycle.disposed || event.type !== 'user/message' || event.data.source.kind !== 'team-message') return
    const source = event.data.source
    const acknowledgement = Promise.resolve().then(async () => {
      const rootAgent = this.deps.roster.tryMembership(owner.agent)?.root.agent
      if (rootAgent !== undefined) await this.checkpointDelivered(rootAgent, owner.session, source.messageId)
    }).catch((error: unknown) => {
      this.deps.warn(`Team message "${source.messageId}" acknowledgement failed: ${errorMessage(error)}`)
    })
    void this.trackDispatch(acknowledgement)
  }

  /**
   * Retry durable pending messages relevant to one started Team member.
   * @param agent - newly started exact live Agent.
   * @param signal - shared runtime cancellation.
   */
  async recoverFor(agent: NativeAgent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const membership = this.deps.roster.tryMembership(agent)
    if (membership === undefined) return
    const state = this.deps.journal.state(membership.root)
    const messages = state.messages.filter(message =>
      !state.delivered.includes(message.id)
      && (membership.role === 'lead' || message.targetId === SessionId(agent.id)))
    for (const message of messages) {
      signal.throwIfAborted()
      await this.tryDispatch(membership.root, message, signal)
    }
  }

  /**
   * Return admitted dispatch and acknowledgement operations captured for disposal.
   * @returns detached snapshot ordered only by Set insertion.
   */
  pendingDispatches(): readonly Promise<unknown>[] {
    return [...this.inFlightDispatches]
  }

  /** Queue and dispatch one mailbox item admitted before the disposal cutoff. */
  private async sendAdmitted(caller: NativeAgent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    const membership = this.deps.roster.membership(caller)
    request.signal.throwIfAborted()
    const root = membership.root
    const content = structuredClone(request.content)
    const queued = await this.deps.journal.transact(root.id, async () => {
      request.signal.throwIfAborted()
      const state = this.deps.journal.state(root)
      const target = resolveActiveMember(root, state, request.target)
      if (target.id === SessionId(caller.id)) throw new TeamError('a Team member cannot message itself', 'TEAM_SELF_MESSAGE')
      const pendingForTarget = state.messages.filter(candidate =>
        candidate.targetId === target.id && !state.delivered.includes(candidate.id)).length
      if (pendingForTarget >= this.deps.maxPendingMessagesPerMember) {
        throw new TeamError(
          `teammate "${target.name}" has ${pendingForTarget} pending messages`,
          'TEAM_MAILBOX_FULL',
        )
      }
      const message: TeamMessageSnapshot = {
        id: TeamMessageId(`team-message-${randomUUID()}`),
        senderId: SessionId(caller.id),
        senderName: membership.name,
        targetId: target.id,
        content,
      }
      if (Buffer.byteLength(JSON.stringify(this.deliveryContent(message)), 'utf8') > this.deps.maxMessageBytes) {
        throw new TeamError(`team message exceeds ${this.deps.maxMessageBytes} bytes`, 'TEAM_MESSAGE_TOO_LARGE')
      }
      await this.deps.journal.appendAndFlush(root, 'team/message/queued', {
        version: 2,
        teamId: TeamId(root.id),
        message,
      })
      // Register dispatch before releasing the root transaction so concurrent
      // senders enter the target-local queue in durable mailbox order.
      return { message, dispatch: this.tryDispatch(root, message, request.signal) }
    })
    const accepted = await queued.dispatch
    return { messageId: queued.message.id, status: accepted ? 'accepted' : 'queued' }
  }

  /** Attempt one queued message exactly once in this process at a time. */
  private tryDispatch(root: NativeTeamRoot, message: TeamMessageSnapshot, signal: AbortSignal): Promise<boolean> {
    if (this.deps.lifecycle.disposed) return Promise.resolve(false)
    if (this.inFlightMessages.has(message.id)) return Promise.resolve(false)
    this.inFlightMessages.add(message.id)
    const operation = this.trackDispatch(
      this.tryDispatchAdmitted(root, message, AbortSignal.any([signal, this.deps.lifecycle.signal])),
    )
    const forget = (): void => { this.inFlightMessages.delete(message.id) }
    void operation.then(forget, forget)
    return operation
  }

  /** Track one dispatch transaction through delivery admission or contained failure. */
  private trackDispatch<T>(operation: Promise<T>): Promise<T> {
    this.inFlightDispatches.add(operation)
    void operation.then(() => {
      this.inFlightDispatches.delete(operation)
    }, () => {
      this.inFlightDispatches.delete(operation)
    })
    return operation
  }

  /** Attempt one queued message admitted before the service lifecycle cutoff. */
  private async tryDispatchAdmitted(
    root: NativeTeamRoot,
    message: TeamMessageSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    return await this.serializeDispatch(message, () => this.dispatchThrough(root, message, signal))
  }

  /** Serialize delivery admission for one durable target in queued order. */
  private async serializeDispatch(
    message: TeamMessageSnapshot,
    operation: () => Promise<boolean>,
  ): Promise<boolean> {
    const targetId = message.targetId
    const prior = this.dispatchTails.get(targetId) ?? Promise.resolve()
    // Recorded tails always settle fulfilled; a later dispatch only waits for
    // the previous attempt to finish.
    const run = prior.then(operation)
    const tail = run.then(() => undefined, () => undefined)
    this.dispatchTails.set(targetId, tail)
    try {
      return await run
    } finally {
      if (this.dispatchTails.get(targetId) === tail) this.dispatchTails.delete(targetId)
    }
  }

  /** Deliver every pending target message through `message` in durable queue order. */
  private async dispatchThrough(
    root: NativeTeamRoot,
    message: TeamMessageSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    const state = this.deps.journal.state(root)
    const pending = state.messages.filter(candidate =>
      candidate.targetId === message.targetId && !state.delivered.includes(candidate.id))
    const requested = pending.findIndex(candidate => candidate.id === message.id)
    if (requested < 0) return state.delivered.includes(message.id)
    for (const candidate of pending.slice(0, requested + 1)) {
      const ownsInFlight = !this.inFlightMessages.has(candidate.id)
      if (ownsInFlight) this.inFlightMessages.add(candidate.id)
      try {
        if (!await this.dispatchOnce(root, candidate, signal)) return false
      } finally {
        if (ownsInFlight) this.inFlightMessages.delete(candidate.id)
      }
    }
    return true
  }

  /** Attempt one queued delivery after target-local ordering admits it. */
  private async dispatchOnce(
    root: NativeTeamRoot,
    message: TeamMessageSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      const target = this.deps.ownerOfSession(message.targetId)
      if (target !== undefined) {
        if (this.targetRecorded(target.session, message.id)) {
          await this.markDelivered(root, message.id, target.session.id)
          return true
        }
        const input = createUserMessage({ content: this.deliveryContent(message), source: this.messageSource(root, message) })
        await target.enqueue(input, 'next-step', true, signal)
        await this.markDelivered(root, message.id, target.session.id)
        return true
      }
      const recorded = await this.persistedTargetRecorded(message.targetId, message.id, signal)
      if (recorded === undefined) return false
      if (recorded) {
        await this.markDelivered(root, message.id, message.targetId)
        return true
      }
      await this.deps.subagents.sendMessage({
        agent: root.agent,
        session: root.session,
        target: message.targetId,
        content: this.deliveryContent(message),
      }, signal)
      await this.markDelivered(root, message.id, message.targetId)
      return true
    } catch (error: unknown) {
      this.deps.warn(`team message "${message.id}" remains queued: ${errorMessage(error)}`)
      return false
    }
  }

  /** Flush one live target receipt before the Lead records its delivered edge. */
  private async checkpointDelivered(
    rootAgent: NativeAgent,
    target: Session,
    messageId: TeamMessageId,
  ): Promise<boolean> {
    const root = this.deps.roster.membership(rootAgent).root
    if (!this.targetRecorded(target, messageId)) return false
    await this.markDelivered(root, messageId, target.id)
    return true
  }

  /** Record delivery unless the acknowledgement already exists. */
  private async markDelivered(root: NativeTeamRoot, messageId: TeamMessageId, targetId: SessionId): Promise<void> {
    await this.deps.journal.transact(root.id, async () => {
      const state = this.deps.journal.state(root)
      if (state.delivered.includes(messageId)) return
      const queued = state.messages.find(message => message.id === messageId)
      if (queued === undefined || queued.targetId !== targetId) return
      await this.deps.journal.appendAndFlush(root, 'team/message/delivered', {
        version: 2,
        teamId: TeamId(root.id),
        messageId,
        targetId,
      })
    })
  }

  /** Whether a target Session already contains the durable message identity. */
  private targetRecorded(session: Session, messageId: TeamMessageId): boolean {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const suffix = session.snapshotEvents(session.inheritedEventCount)
    return messageAccepted(suffix, message => message.source.kind === 'team-message'
      && message.source.messageId === messageId)
  }

  /** Stable durable provenance for one delivered peer item. */
  private messageSource(root: NativeTeamRoot, message: TeamMessageSnapshot) {
    return {
      kind: 'team-message' as const,
      teamId: TeamId(root.id),
      messageId: message.id,
      senderId: message.senderId,
      senderName: message.senderName,
    }
  }

  /** Frame peer content with stable sender and message identity for the receiving model. */
  private deliveryContent(message: TeamMessageSnapshot): ContentBlock[] {
    return [
      { type: 'text', text: `Team message ${message.id} from ${message.senderName}:` },
      ...structuredClone(message.content),
    ]
  }

  /** Read an inactive target's durable log before cold resume; uncertainty keeps the mailbox queued. */
  private async persistedTargetRecorded(
    targetId: SessionId,
    messageId: TeamMessageId,
    signal: AbortSignal,
  ): Promise<boolean | undefined> {
    try {
      const stored = await readPersistedSession(this.deps.persistence, targetId, signal)
      const suffix = stored.events.slice(stored.inheritedEventCount)
      return messageAccepted(suffix, message => message.source.kind === 'team-message'
        && message.source.messageId === messageId)
    } catch (error: unknown) {
      this.deps.warn(`cannot read Team message target "${targetId}": ${errorMessage(error)}`)
      return undefined
    }
  }
}
