# Request Context

English | [中文](request-context.zh.md)

The `requestContexts` Native service lets scoped Providers prepare durable messages for one model request while the selected Program retains the exact Session owner, final admission checks, and single append-and-flush path. The [Definition package](../../Engine/context/request-context-definition/README.md) declares the shared API; the [Provider package](../../Engine/context/request-context/README.md) implements its scoped registry.

Each visible Provider prepares detached messages and candidate state from one request containing the exact active owner, admitted inputs, durable event snapshot, and captured model/PTC tool registrations. The Program invokes every preparation before final synchronous admission checks, appends the messages with the request's other inputs through its existing writer, and flushes. The registry commits Provider state only after the Program reports acceptance; rejection leaves prepared state uncommitted.

`NativeRequestContextProviderId` is the branded id constructor/type. Providers are ordered by finite integer `order`, then id; a nearer registration with the same id shadows an outer one. The `NativeRequestContexts` service checks visibility, registers Providers with exact drainable disposers, and prepares visible Providers before invoking one Program-supplied acceptance callback. A visible Provider requires an exact active Session owner. An empty visible set still invokes the callback when the service is installed.

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

Source: [`rsh/Engine/context/request-context-definition/src/index.ts`](../../Engine/context/request-context-definition/src/index.ts)
