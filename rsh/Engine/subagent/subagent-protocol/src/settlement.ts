/** Durable runtime-owned notices shared by compatibility and native subagents. */
import { boundContextSummary, createUserMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

/** Terminal facts for one child residency, after actual writer and Agent cleanup. */
export interface SubagentSettlement {
  /** Recorded work ending; cleanup failure reports error. */
  readonly stopReason: string
  /** Final content from this residency, absent after cleanup failure. */
  readonly output?: ContentBlock[]
}

/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link AgentMessageSource}: an Agent message is content the sender chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
export interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    'subagent-settled': SubagentSettledMessageSource
  }
}

/**
 * One line telling a parent that a background child is finished and why, in
 * the parent's own task vocabulary.
 * @param childId - the durable child the parent knows by id.
 * @param stopReason - how the child's last ordinary turn ended.
 * @returns the model-facing opening line of the settlement notice.
 */
function settlementSummary(childId: SessionId, stopReason: string): string {
  const subject = `Background subagent ${childId}`
  switch (stopReason) {
    case 'completed':
      return `${subject} finished and will do no further work unless you send it more.`
    case 'aborted':
      return `${subject} was stopped before it finished.`
    case 'max-tokens':
      return `${subject} ran out of room before it finished.`
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // the child had claimed, so the parent must not treat the task as done.
    case 'refusal':
      return `${subject} declined the task.`
    case 'error':
      return `${subject} failed before it finished.`
    /* v8 ignore next 4 -- the ending vocabulary is merge-extensible, so this arm
     * needs a backend that adds a variant; an unnameable ending is reported as unfinished
     * rather than silently as success. */
    default:
      return `${subject} ended abnormally (${stopReason}) before it finished.`
  }
}

/**
 * Build the runtime-owned settlement notice delivered to a child's parent.
 * @param childId - durable child session id named in the notice.
 * @param terminal - recorded terminal state for the settled Activation.
 * @returns the durable user-message representation delivered to the parent.
 */
export function createSettlementMessage(
  childId: SessionId,
  terminal: SubagentSettlement,
): UserMessage {
  const summary = settlementSummary(childId, terminal.stopReason)
  return createUserMessage({
    content: [
      { type: 'text' as const, text: summary },
      ...terminal.output === undefined
        ? [{ type: 'text' as const, text: 'It left no closing message.' }]
        : [{ type: 'text' as const, text: 'Its closing message:' }, ...terminal.output],
    ],
    source: {
      kind: 'subagent-settled' as const,
      form: 'notice' as const,
      summary: boundContextSummary(summary),
      senderSessionId: childId,
    },
  })
}

/** Select a child epoch's ending from its accepted-work accounting.
 * @param work - the shared consumed-work fold of this epoch's own durable suffix.
 * @returns the recorded ending, including accepted work dropped before it ran.
 */
export function subagentEpochStopReason(work: { readonly end?: SessionEvent<'turn/end'>; readonly droppedUnrun: boolean }): 'completed' | 'max-tokens' | 'aborted' | 'refusal' | 'error' {
  const { end, droppedUnrun } = work
  switch (end?.data.reason.kind) {
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
    case 'interrupted':
      return 'aborted'
    case 'error':
      return 'error'
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // this epoch had claimed: the work was declined, not done.
    case 'blocked':
      return 'refusal'
    // A clean ending and no accounting turn at all share one rule: the epoch
    // finished what it was given unless a cancelled queue says otherwise.
    case undefined:
    case 'completed':
      return droppedUnrun ? 'aborted' : 'completed'
    /* v8 ignore next 3 -- `TurnEndReason` is merge-extensible, so this arm needs a
     * backend that adds a variant; treating an unnameable reason as success would
     * report failed work as completed. */
    default:
      return 'error'
  }
}
