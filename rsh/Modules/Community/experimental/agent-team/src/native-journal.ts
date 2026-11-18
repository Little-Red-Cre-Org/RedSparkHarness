/** Native Team transactions over the selected Program's exact active Session writer. */

import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { NativeSessionProjectionOperations } from '@redspark/rsh-session-projection/native'
import type { Session, SessionEventMap, SessionId } from '@redspark/rsh-session/native'
import { TeamError } from './error.ts'
import type { TeamJournalPort, TeamMutableEventType, TeamRootRef } from './journal-port.ts'
import type { TeamState } from './projection.ts'

type AppendTeamEvent = <T extends TeamMutableEventType>(type: T, data: SessionEventMap[T]) => void

/** Root Session identity paired with the exact live Native Agent that owns it. */
export interface NativeTeamRoot extends TeamRootRef {
  readonly agent: NativeAgent
  readonly session: Session
}

/** Per-Lead transaction order and committed Team event publication for Native writers. */
export class NativeTeamJournal implements TeamJournalPort<NativeTeamRoot> {
  private readonly tails = new Map<SessionId, Promise<void>>()

  /**
   * @param active - exact active-owner routing selected by this Program.
   * @param projections - registered Team projection owner.
   * @param onCommit - synchronous notification after the Team event flush succeeds.
   */
  constructor(
    private readonly active: NativeActiveSessionOperations,
    private readonly projections: NativeSessionProjectionOperations,
    private readonly onCommit: (root: NativeTeamRoot) => void,
  ) {}

  /** @inheritdoc */
  state(root: NativeTeamRoot): TeamState {
    const owner = this.owner(root)
    const projection = this.projections.stateOf(owner.session, 'agentTeam')
    if (projection === undefined) throw new Error('Agent Teams projection is not registered')
    if (projection.failure !== undefined) throw new Error(projection.failure)
    return projection
  }

  /** @inheritdoc */
  async transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(rootId) ?? Promise.resolve()
    // Recorded tails always settle fulfilled, so a later transaction only needs
    // the success continuation.
    const run = prior.then(operation)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(rootId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(rootId) === tail) this.tails.delete(rootId)
    }
  }

  /** @inheritdoc */
  async appendAndFlush<T extends TeamMutableEventType>(
    root: NativeTeamRoot,
    type: T,
    data: SessionEventMap[T],
  ): Promise<void> {
    const owner = this.owner(root)
    const append = owner.append.bind(owner) as unknown as AppendTeamEvent
    append(type, data)
    await owner.flush()
    this.onCommit(root)
  }

  /** Resolve the retained writer for one exact live Lead Session. */
  private owner(root: NativeTeamRoot): NativeActiveSessionOwner {
    const owner = this.active.owner(root.agent, root.session)
    if (owner === undefined) {
      throw new TeamError(`Team Lead Session "${root.id}" is not active`, 'TEAM_NOT_ACTIVE')
    }
    return owner
  }
}
