/** Durable Session-message acceptance checks shared by provisioning and mailbox recovery. */

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent/types'

type InboxProjection = Record<'next-turn' | 'next-step', UserMessage[]>

/** Fold the durable inbox suffix into the messages still awaiting a claim. */
function pendingInboxMessages(events: readonly SessionEvent[]): UserMessage[] {
  const inbox: InboxProjection = { 'next-turn': [], 'next-step': [] }
  for (const event of events) {
    if (event.type === 'agent/inbox/moved') {
      const index = inbox['next-turn'].findIndex(message => message.id === event.data.messageId)
      if (index < 0) throw new Error(`agent-team: invalid persisted inbox move at seq ${event.seq}`)
      const [message] = inbox['next-turn'].splice(index, 1)
      if (message === undefined) throw new Error(`agent-team: moved inbox message disappeared at seq ${event.seq}`)
      inbox['next-step'].push(message)
    } else if (event.type === 'agent/inbox/spliced') {
      const pending = inbox[event.data.target]
      pending.splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
    }
  }
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
