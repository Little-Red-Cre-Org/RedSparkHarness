/** Cordis-free service ports shared by both session-query tool installers. */
import type { SessionQueryOperations } from '@redspark/rsh-session-query/native'
import type { Session } from '@redspark/rsh-session/native'
import type { TurnBoundaryProjection } from '@redspark/rsh-native-agent/turn-boundary'

/** Services used by the shared workspace authorization and tool operations. */
export interface SessionQueryToolServices {
  readonly sessionQuery: SessionQueryOperations
  readonly sessionProjections: {
    stateOf(session: Session, key: 'turnBoundary'): TurnBoundaryProjection | undefined
  }
  readonly warn?: (message: string) => void
}

/** Caller facts that both tool runtimes expose to the shared operations. */
export interface SessionQueryToolInvocation {
  readonly agent?: { readonly session: Session } | undefined
  readonly signal: AbortSignal
}
