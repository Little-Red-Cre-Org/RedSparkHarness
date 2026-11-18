/** Caller and root identity vocabulary shared by both Team runtime faces. */

import type { SessionId } from '@redspark/rsh-session/types'
import { TeamError } from './error.ts'
import type { TeamRootRef } from './journal-port.ts'
import type { TeamState } from './projection.ts'
import type { TeamId } from './types.ts'

/** Caller identity inside one implicit Team. */
export interface TeamCallerMembership<R extends TeamRootRef = TeamRootRef> {
  /** Exact live Team Lead owning the durable records. */
  readonly root: R
  /** Implicit Team identity derived from the root Session identity. */
  readonly id: TeamId
  /** Caller role inside this Team. */
  readonly role: 'lead' | 'teammate'
  /** Model-facing caller name; the Lead is always `lead`. */
  readonly name: string
}

/** Caller identity needed by authorization and task ownership checks. */
export interface TeamCallerRef {
  readonly id: SessionId
}

/**
 * Resolve one active Team member by model-facing name, including the Lead pseudo-row.
 * @param root - exact live Team Lead.
 * @param state - current Team state.
 * @param rawName - candidate member name.
 * @returns resolved durable id and normalized name.
 */
export function resolveActiveMember(
  root: TeamRootRef,
  state: TeamState,
  rawName: string,
): { id: SessionId; name: string } {
  const name = rawName.trim()
  if (name === 'lead') return { id: root.id, name }
  const member = state.members.find(candidate => candidate.name === name)
  if (member === undefined || member.phase !== 'active') {
    throw new TeamError(`active teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
  }
  return { id: member.id, name }
}
