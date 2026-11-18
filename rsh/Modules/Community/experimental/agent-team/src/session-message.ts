/** Durable Session-message acceptance checks shared by provisioning and mailbox recovery. */

import type { UserMessage } from '@redspark/rsh-llm/native'
import { foldNativeInboxEvent, type NativeInboxState } from '@redspark/rsh-native-agent/inbox'
import type { SessionEvent } from '@redspark/rsh-session/native'

/** Fold the durable inbox suffix into the messages still awaiting a claim. */
function pendingInboxMessages(events: readonly SessionEvent[]): UserMessage[] {
  const inbox = events.reduce<NativeInboxState>(foldNativeInboxEvent, { 'next-turn': [], 'next-step': [] })
  return [...inbox['next-turn'], ...inbox['next-step']]
}

/**
 * Test whether one message is model-visible or still durably pending.
 * @param events - one Session's non-inherited event suffix.
 * @param predicate - identity check for the accepted message.
 * @returns whether history or the current inbox contains a match.
 */
export function messageAccepted(
  events: readonly SessionEvent[],
  predicate: (message: UserMessage) => boolean,
): boolean {
  return events.some(event => event.type === 'user/message' && predicate(event.data))
    || pendingInboxMessages(events).some(predicate)
}
