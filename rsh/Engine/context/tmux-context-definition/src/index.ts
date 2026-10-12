/** Native request-preparation Definition for durable tmux context. */
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-native-runtime'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { tmuxContext: NativeTmuxContext }
}

/** One native request that may receive a durable tmux location message. */
export interface NativeTmuxContextRequest {
  /** Exact Session whose committed events seed the Provider. */
  readonly session: Session
  /** Open turn receiving a possible message. */
  readonly turn: number
  /** Open step receiving a possible message. */
  readonly step: number
  /** Cancels the request and its owned tmux query. */
  readonly signal: AbortSignal
}

/** Native Headless service that reconstructs tmux state from committed Session events. */
export interface NativeTmuxContext {
  /**
   * Seed state from the Session owner's loaded event prefix.
   * @param session Session whose committed events seed the Provider.
   * @param events Loaded committed Session events in append order.
   */
  seed(session: Session, events: readonly SessionEvent[]): void
  /**
   * Record one Session append after it has been committed by its owner.
   * @param session Session receiving the committed event.
   * @param event Event already appended by the Session owner.
   */
  record(session: Session, event: SessionEvent): void
  /**
   * Prepare a message before model dispatch; the caller appends any result to the Session.
   * @param request Request scope and cancellation signal for this preparation.
   * @returns The model-visible message to append, or `undefined` when no tmux context applies.
   */
  prepare(request: NativeTmuxContextRequest): Promise<UserMessage | undefined>
}
