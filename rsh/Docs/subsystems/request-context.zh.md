# 请求上下文

[English](request-context.md) | 中文

`requestContexts` Native 服务允许按作用域管理的 Provider 为一次模型请求准备持久消息，同时由所选 Program 保留精确 Session owner、最终准入检查以及唯一的追加与 flush 路径。[Definition 包](../../Engine/context/request-context-definition/README.zh.md)声明共享 API；[Provider 包](../../Engine/context/request-context/README.zh.md)实现按作用域管理的注册表。

每个可见 Provider 都会基于同一请求准备分离的消息和候选状态。请求包含精确活动 owner、已准入输入、durable event 快照，以及捕获的 model/PTC 工具注册。Program 会先完成所有准备，再同步执行最终准入检查；随后通过既有 writer 将这些消息与请求的其他输入一并追加并 flush。只有 Program 报告接受后，注册表才提交 Provider 状态；拒绝时不提交准备状态。

`NativeRequestContextProviderId` 是品牌化的 id 构造函数与类型。Provider 按有限整数 `order`、再按 id 排序；较近 scope 中的同 id 注册会 shadow 外层注册。`NativeRequestContexts` 服务检查可见性、以精确且可排空的 disposer 注册 Provider，并在调用 Program 提供的唯一接受回调前准备所有可见 Provider。可见 Provider 要求存在精确活动 Session owner。服务已安装但没有可见 Provider 时，仍会调用该回调。

```ts type-equiv
/** Opaque provider identity used for scope shadowing and deterministic message order. */
type NativeRequestContextProviderId = Branded<'NativeRequestContextProviderId'>
```

```ts type-equiv
/** Result of the Program's final admission checks and durable accept callback. */
type NativeRequestContextAcceptance = 'accepted' | 'rejected'
```

```ts type-equiv
/** Exact registrations included in this model request's captured model or PTC tool catalog. */
interface NativeRequestToolVisibility {
  /**
   * Test the exact registration identity against the snapshots used by this request.
   * @param registration - disposer returned by the tool registration.
   * @returns whether that exact registration is visible to the model or PTC program.
   */
  includes(registration: NativeToolRegistration): boolean
}
```

```ts type-equiv
/** One exact-owner request supplied to all visible request-context providers. */
interface NativeRequestContextRequest {
  /** Exact active Session owner retained by the selected Program. */
  readonly owner: NativeActiveSessionOwner
  /** Dynamic Agent scope used by this request. */
  readonly scope: NativeScope
  /** Current turn number. */
  readonly turn: number
  /** Current model-request step number. */
  readonly step: number
  /** Final admitted direct user inputs for this request. */
  readonly inputs: readonly UserMessage[]
  /** One durable event snapshot read through `owner.readEvents()`. */
  readonly durableEvents: readonly SessionEvent[]
  /** Exact captured tool visibility after every allowlist and shadow rule. */
  readonly toolVisibility: NativeRequestToolVisibility
  /** Program and provider cancellation. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Detached request messages and state committed only after the Program's durable accept. */
interface PreparedNativeRequestContext {
  /** Model-visible messages to append to the exact owner's Session. */
  readonly messages: readonly UserMessage[]
  /** Commit provider-local last-good state after the owner flush succeeds. */
  commit(): void
}
```

```ts type-equiv
/** Provider of durable messages for one Native model request. */
interface NativeRequestContextProvider {
  /** Stable identity; a nearer registration with the same ID replaces this provider. */
  readonly id: NativeRequestContextProviderId
  /** Finite integer order before the ID tie-breaker. */
  readonly order: number
  /**
   * Prepare detached messages and candidate state without writing the Session or advancing last-good state.
   * @param request - exact owner, captured input, durable history and model-tool visibility.
   * @returns messages and state that may be committed after durable acceptance.
   */
  prepare(request: NativeRequestContextRequest): Promise<PreparedNativeRequestContext>
}
```

```ts type-equiv
/** Native Host service for exact-owner, durable request-context contributions. */
interface NativeRequestContexts {
  /**
   * Check whether a request scope has any visible providers before requiring its exact active Session owner.
   * @param scope - dynamic Agent scope to inspect.
   * @returns whether the nearest-scope contribution view is nonempty.
   */
  hasProviders(scope: NativeScope): boolean
  /**
   * Register one provider in a Native scope; its disposer closes admission and drains accepted request preparations.
   * @param scope - registration scope within this Provider's realm.
   * @param provider - stable identity, order and detached preparation callback.
   * @returns exact idempotent asynchronous removal and drain.
   */
  register(scope: NativeScope, provider: NativeRequestContextProvider): () => Promise<void>
  /**
   * Prepare all visible providers and offer their messages to the Program's single durable acceptance callback.
   * @param request - exact active owner, one durable snapshot, final inputs and captured tool visibility.
   * @param accept - Program callback that checks admission, appends messages and flushes the exact owner.
   * @returns whether the request was durably accepted; preparation and durability failures reject.
   */
  prepareAndAccept(
    request: NativeRequestContextRequest,
    accept: (messages: readonly UserMessage[]) => Promise<NativeRequestContextAcceptance>,
  ): Promise<NativeRequestContextAcceptance>
  /** Close provider admission and drain all accepted preparations.
   * @returns completion of every preparation and Program acceptance already admitted.
   */
  dispose(): Promise<void>
}
```

来源：[`rsh/Engine/context/request-context-definition/src/index.ts`](../../Engine/context/request-context-definition/src/index.ts)
