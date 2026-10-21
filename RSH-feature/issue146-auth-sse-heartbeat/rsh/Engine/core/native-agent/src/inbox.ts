/** Framework-independent durable pending-message list facts shared by Agent implementations. */
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session/types'

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

/** Detached ordered pending lists reconstructed from durable inbox events. */
export interface NativeInboxState {
  /** Messages retained for later turns. */
  readonly 'next-turn': readonly UserMessage[]
  /** Messages admitted at the next model-step boundary. */
  readonly 'next-step': readonly UserMessage[]
}

/**
 * Fold one durable inbox fact, rejecting an invalid list transition.
 * @param state - current ordered pending lists.
 * @param event - persisted Session event to apply.
 * @returns new lists after the event.
 */
export function foldNativeInboxEvent(state: NativeInboxState, event: SessionEvent): NativeInboxState {
  if (event.type === 'agent/inbox/moved') {
    const index = state['next-turn'].findIndex(message => message.id === event.data.messageId)
    if (index < 0 || state['next-step'].some(message => message.id === event.data.messageId)) {
      throw new Error(`invalid persisted inbox move at session seq ${event.seq}`)
    }
    const message = state['next-turn'][index]
    if (message === undefined) throw new Error(`invalid persisted inbox move at session seq ${event.seq}`)
    return {
      'next-turn': state['next-turn'].toSpliced(index, 1),
      'next-step': [...state['next-step'], message],
    }
  }
  if (event.type !== 'agent/inbox/spliced') return state
  const { target, start, inserted } = event.data
  const list = state[target]
  const removedCount = event.data.removedCount ?? 0
  if (!Number.isSafeInteger(start) || start < 0 || start > list.length
    || !Number.isSafeInteger(removedCount) || removedCount < 0 || start + removedCount > list.length) {
    throw new Error(`invalid persisted inbox splice at session seq ${event.seq}`)
  }
  const next = list.toSpliced(start, removedCount, ...inserted)
  const nextTurn = target === 'next-turn' ? next : state['next-turn']
  const nextStep = target === 'next-step' ? next : state['next-step']
  const ids = new Set<string>()
  for (const message of [...nextTurn, ...nextStep]) {
    if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending at session seq ${event.seq}`)
    ids.add(message.id)
  }
  return { 'next-turn': nextTurn, 'next-step': nextStep }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * The session-projection registry applies the committed event before
     * `Session.append()` returns; Inbox live notifications follow that commit.
     * @param data - selected list splice and optional cancellation attribution.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
    /**
     * Move one queued message to the end of the next-step list as one replayable fact.
     * @param data - exact queued message identity to move.
     * @param data.messageId - stable id already pending in `next-turn`.
     */
    'agent/inbox/moved': { messageId: MessageId }
  }
}
