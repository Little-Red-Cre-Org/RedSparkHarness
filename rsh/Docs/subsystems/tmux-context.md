# Tmux Context

English | [中文](tmux-context.zh.md)

The `tmuxContext` Native service lets an application prepare durable tmux location context without adding a Session writer to its Provider. The Cordis-free Definition is [`rsh/Engine/context/tmux-context-definition/src/index.ts`](../../Engine/context/tmux-context-definition/src/index.ts); the Native Provider is [`rsh/Modules/Official/terminal/native-tmux-context`](../../Modules/Official/terminal/native-tmux-context/README.md).

Native Headless seeds the service from its loaded Session event prefix, records every committed event, and appends a prepared user message through its existing writer after checking cancellation. The Provider's output therefore participates in request history and cold reconstruction without a new Session event type.

```ts type-equiv
/** One native request that may receive a durable tmux location message. */
interface NativeTmuxContextRequest {
  /** Exact Session whose committed events seed the Provider. */
  readonly session: Session
  /** Open turn receiving a possible message. */
  readonly turn: number
  /** Open step receiving a possible message. */
  readonly step: number
  /** Cancels the request and its owned tmux query. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Native Headless service that reconstructs tmux state from committed Session events. */
interface NativeTmuxContext {
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
```

Source: [`rsh/Engine/context/tmux-context-definition/src/index.ts`](../../Engine/context/tmux-context-definition/src/index.ts)
