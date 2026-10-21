/** Shared checkpoint lifecycle matching for compatibility and Native readers. */

import { SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { SessionHeader, SessionLogOffset as SessionLogOffsetValue } from '@deepseek-ai/dsh-session/native'
import type { CheckpointIdentity } from './spec.ts'

/** Complete identity written by the current cache generation. */
export type CurrentCheckpointIdentity = CheckpointIdentity & {
  formatVersion: number
  isSeeded: boolean
  inheritedEventCount: SessionLogOffsetValue
}

/**
 * Project a header onto the identity fields a record is bound to.
 * @param header - Session lifecycle metadata.
 * @param inheritedEventCount - exact fork prefix length.
 * @returns the complete current-generation identity.
 */
export function identityOf(
  header: SessionHeader,
  inheritedEventCount: SessionLogOffsetValue,
): CurrentCheckpointIdentity {
  const cut = SessionLogOffset(inheritedEventCount)
  if (!header.isSeeded && cut !== 0) {
    throw new Error('unseeded projection-cache identity inherited event count must be 0')
  }
  return {
    formatVersion: header.version,
    createdAt: header.createdAt,
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    isSeeded: header.isSeeded,
    inheritedEventCount: cut,
  }
}

/**
 * Match a stored record to the exact current Session format and lifecycle.
 * @param stored - persisted checkpoint identity.
 * @param expected - current Session identity.
 * @returns whether the record can seed a current fold.
 */
export function identityMatches(stored: CheckpointIdentity, expected: CurrentCheckpointIdentity): boolean {
  return stored.formatVersion === expected.formatVersion
    && lifecycleIdentityMatches(stored, expected)
}

/**
 * Match a compatible predecessor record only for its lifecycle-bound title hint.
 * @param stored - persisted predecessor identity.
 * @param expected - current Session identity.
 * @returns whether the record can supply a predecessor title hint.
 */
export function predecessorIdentityMatches(
  stored: CheckpointIdentity,
  expected: CurrentCheckpointIdentity,
): boolean {
  const predecessor = stored.formatVersion === undefined
    || stored.formatVersion < expected.formatVersion
  return predecessor && lifecycleIdentityMatches(stored, expected)
}

/** Match the format-independent fields that distinguish one Session lifecycle. */
function lifecycleIdentityMatches(
  stored: CheckpointIdentity,
  expected: CurrentCheckpointIdentity,
): boolean {
  return stored.createdAt === expected.createdAt
    && stored.cwd === expected.cwd
    && (stored.isSeeded ?? false) === expected.isSeeded
    && (stored.inheritedEventCount ?? 0) === expected.inheritedEventCount
}
