# Tmux 上下文

[English](tmux-context.md) | 中文

`tmuxContext` Native 服务使应用能够准备持久的 tmux 位置上下文，而无需让 Provider 新增 Session writer。Cordis-free Definition 位于 [`rsh/Engine/context/tmux-context-definition/src/index.ts`](../../Engine/context/tmux-context-definition/src/index.ts)；Native Provider 见 [`rsh/Modules/Official/terminal/native-tmux-context`](../../Modules/Official/terminal/native-tmux-context/README.zh.md)。

Native Headless 从已加载的 Session 事件前缀中播种服务，并记录每个已提交事件；检查取消状态后，再通过既有 writer 追加准备好的 user 消息。因此 Provider 输出会进入请求历史并参与冷恢复，无需新增 Session 事件类型。

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

来源：[`rsh/Engine/context/tmux-context-definition/src/index.ts`](../../Engine/context/tmux-context-definition/src/index.ts)
