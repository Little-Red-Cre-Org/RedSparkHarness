/**
 * Native lifecycle announcement events this application emits at the boundaries a
 * bridge needs: a Session's first model request and its stopping boundary.
 *
 * A Native bridge cannot subscribe to the compatibility `agent/session-start` and
 * `agent/turn-stopping`, so the application announces the equivalent facts on the
 * Native event bus. Listeners are told what happened; the application still owns
 * the turn, the writer and the decision to continue.
 *
 * @module @redspark/rsh-native-headless/lifecycle-events
 */

import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { Session, SessionEvent, SessionEventMap, SessionEventType, SurfaceEventType, SurfaceIntent } from '@redspark/rsh-session/native'
import type {} from '@redspark/rsh-native-runtime'

/** Why a Session reached its start boundary. */
export type NativeSessionStartSource = 'startup' | 'resume'

/** One Session announcing that its first model request is about to be prepared. */
export interface NativeSessionStartNotice {
  readonly agent: NativeAgent
  readonly session: Session
  readonly source: NativeSessionStartSource
  /** Cancellation for work this announcement starts. */
  readonly signal: AbortSignal
}

/** One turn announcing that it produces no further step on its own. */
export interface NativeTurnStoppingNotice {
  readonly agent: NativeAgent
  readonly session: Session
  readonly turn: number
  readonly step: number
  /** Cancellation for work this announcement starts. */
  readonly signal: AbortSignal
  /**
   * Append one event to the application's single tracked batch, without persisting.
   *
   * A listener that records its own facts must use this rather than the Session: the
   * batch is contiguous, and an append that bypasses it desynchronizes the turn this
   * announcement is closing.
   */
  readonly appendEvent?: <T extends SessionEventType>(type: T, data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []) => SessionEvent<T>
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeEvents {
    /**
     * One Session is about to make its first model request.
     *
     * Parallel so one slow bridge cannot delay the request; the application does
     * not wait for a listener's injected context to reach the opening request.
     * @mode parallel
     * @param notice - exact Agent and Session, the start source and cancellation.
     */
    'session/starting': { mode: 'parallel'; args: [notice: NativeSessionStartNotice]; result: void }
    /**
     * One turn has produced its last step and no recorded tool call continues it.
     *
     * Awaited before the turn closes so a listener may still admit another step
     * through the exact active Session owner. A listener that adds nothing lets
     * the turn end.
     * @mode serial
     * @param notice - exact Agent, Session, turn and last step number.
     */
    'turn/stopping': { mode: 'serial'; args: [notice: NativeTurnStoppingNotice]; result: void }
  }
}
