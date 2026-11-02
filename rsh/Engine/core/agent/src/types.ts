/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @redspark/rsh-agent/types
 */

import type {} from '@redspark/rsh-session-projection/types'

export type { InboxTarget } from '@redspark/rsh-native-agent/inbox'
import type { UserMessage } from '@redspark/rsh-llm/types'
import type { SessionId } from '@redspark/rsh-session/types'
import type { TypertContext, TypertLookup } from '@redspark/rsh-typert-protocol'
import type { JsonValue } from '@redspark/rsh-util-values'
export type { TurnBoundaryProjection } from '@redspark/rsh-native-agent/turn-boundary'

/** Public live-agent handle; the runtime face augments its live capabilities. */
export interface Agent {
  /** Session-backed Agent identity. */
  readonly id: SessionId
}

declare module '@redspark/rsh-typert-protocol' {
  interface TypertLookupMap {
    agent: TypertLookup<Agent, SessionId>
  }

  interface TypertContextMap {
    /** Agent Context identity shared by Host and Client adapters. */
    agent: TypertContext<SessionId>
  }
}

/** Complete pending Inbox value reconstructed from durable splices. */
export interface InboxState {
  readonly 'next-turn': readonly UserMessage[]
  readonly 'next-step': readonly UserMessage[]
}

/**
 * Wire-JSON pending Inbox value. Each message round-trips the session log
 * losslessly, but the fold state's full `UserMessage` type cannot cross a
 * typert Remote boundary (its source union carries an `unknown` replay
 * field), so the typed projection table keeps this JSON-safe form.
 */
export interface InboxWireState {
  readonly 'next-turn': readonly JsonValue[]
  readonly 'next-step': readonly JsonValue[]
}

declare module '@redspark/rsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Pending agent input reconstructed from durable inbox splices. */
    inbox: InboxState
  }
  interface SessionProjectionMap {
    /** Pending agent input reconstructed from durable inbox splices. */
    inbox: InboxWireState
  }
}
