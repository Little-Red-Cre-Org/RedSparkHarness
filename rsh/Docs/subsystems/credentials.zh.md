# 用户凭据

[English](credentials.md) | 中文

[dsh-credentials](../../Modules/Official/credentials/credentials) 的凭据 seam 把机密挡在配置之外：settings 分节与 `cordis.yml` 条目携带的是*引用*（环境变量名），值归 [dsh-credentials-local](../../Modules/Official/credentials/credentials-local) 这类提供方所有，消费方每个操作解析一次引用——LLM（大语言模型）适配器每次模型请求解析一次，因此轮换后的凭据无需任何重启即可作用于紧随其后的下一次请求。一条 seam 级规则约束每个提供方：空的存储值在任何地方都视为不存在。

来源：[`rsh/Modules/Official/credentials/credentials/src/index.ts`](../../Modules/Official/credentials/credentials/src/index.ts)

## 标识

引用以 POSIX 风格环境变量名命名一条凭据。brand 防止调用方将凭据引用与在包或进程之间传递的其他字符串混用；构造时校验 shell 标识符语法。

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## 解析

`resolve(ref)` 返回值及提供该值的来源层（由提供方定义）；未配置期间返回 `undefined`。消费方在每个操作中重新解析，绝不跨操作缓存——这种按操作进行的读取正是热更新机制。

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## 描述

`describe(ref)` 在绝不暴露值的前提下回应配置界面：引用当前是否可解析、来自哪一层、`set` 当前能否成功。本地提供方把由当前进程环境供值的引用报告为 `writable: false`——那样的写入会表面成功而解析持续返回遮蔽值，因此 seam 直接拒绝，界面也得以提前把该引用渲染为只读。

```ts type-equiv
/**
 * Source and writability facts for one reference, safe for configuration UIs —
 * never the value. The view has no slot a value could ride in, which is what
 * lets the whole read half cross the Remote wire.
 */
interface CredentialInfo {
  /** Whether resolving the reference would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether the active provider can write this reference. */
  writable: boolean
}
```

## 已提交的变更

`credentials/reference-updated (ref)` 在提供方管理的来源发生已提交变更后发出——`set`、`unset` 或在存储中观察到的外部编辑。进程环境自身的变化不可观测，永不发出事件。消费方不需要该事件（它们按操作重新解析）；它服务于配置界面刷新「已配置」徽标。

## Native Host service

Native Host 消费方从按其 scope 选出的 `credentials` Provider 接收记录变更。`onRecordUpdated` 在 Provider 提交已更新快照后传递带品牌的 key；回调会同步调用，但返回的异步工作不会延迟凭据写入。disposer 会关闭新回调的准入并等待已开始的回调，因此消费方应通过 `context.effect` 注册它，并在回调之外调用。此 service 通知与下方的 Cordis 事件分开。

凭据提供方还按 `CredentialKey` 存储拥有者私有的 JSON 元数据。元数据不会解析为凭据、不会出现在 `listRecords` 中，也不会发出记录更新事件。提供方可以在同一把锁下协调旧记录与元数据，并且只有在验证元数据已持久化后才移除旧记录。

```ts type-equiv
/** Service implemented by a native credential Provider. */
interface NativeCredentials {
  resolve(ref: CredentialRef): Promise<NativeResolvedCredential | undefined>
  describe(ref: CredentialRef): Promise<CredentialInfo>
  set(ref: CredentialRef, value: string): Promise<void>
  unset(ref: CredentialRef): Promise<void>
  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>
  /**
   * Read owner-private JSON metadata kept outside enumerable credential records.
   * @param key - owner-scoped address.
   * @returns the JSON value, or `undefined` while absent.
   */
  readMetadata(key: CredentialKey): Promise<unknown>
  /**
   * Read-decide-replace owner-private JSON metadata under the Provider's write lock.
   * Returning `undefined` leaves the current value unchanged.
   * @param key - owner-scoped address.
   * @param mutate - decides the next JSON value from the current one.
   * @param options - `signal` is checked before mutation begins; once it begins the value is committed.
   * @returns the committed value, or the unchanged current value.
   */
  modifyMetadata(
    key: CredentialKey,
    mutate: (current: unknown) => Promise<unknown>,
    options?: NativeCredentialWriteOptions,
  ): Promise<unknown>
  /**
   * Reconcile a legacy record and metadata value under the shared file lock.
   * Metadata is written and read back before the legacy record is removed; the two writes are not
   * one atomic transaction.
   * @param key - address shared by the old record and new metadata value.
   * @param migrate - validates detached metadata and legacy values; sibling records are detached copies read from the same locked snapshot.
   * @param options - checked when its queued operation starts, before lock acquisition; aborting
   *   afterward does not stop migration.
   * @returns the verified metadata value.
   */
  migrateRecordToMetadata(
    key: CredentialKey,
    migrate: (
      current: unknown,
      legacy: CredentialRecord | undefined,
      readRecord: (key: CredentialKey) => CredentialRecord | undefined,
    ) => Promise<CredentialMetadataMigration>,
    options?: NativeCredentialWriteOptions,
  ): Promise<unknown>
  describeRecord(key: CredentialKey): Promise<NativeCredentialRecordInfo>
  listRecords(): Promise<readonly NativeCredentialRecordEntry[]>
  /**
   * Receive a committed record change from this selected Provider instance.
   * The Provider invokes the listener synchronously after a durable write or
   * removal, or after adopting an observed external change. Asynchronous
   * listener work does not delay the operation. Listener failures are logged
   * and contained; the disposer stops later delivery and drains admitted work.
   * @param listener - callback receiving the changed record address, never its payload.
   * @returns an idempotent disposer; call it outside the listener so it cannot await itself.
   */
  onRecordUpdated(listener: (key: CredentialKey) => void | Promise<void>): () => Promise<void>
  /**
   * Read-decide-replace one record under the Provider's write queue.
   * @param key - record address.
   * @param mutate - decides the next record from the current one; undefined keeps it.
   * @param options - `signal` is checked when the queued write starts, before
   *   reading; once `mutate` begins the write always commits. A queued write
   *   rejects with the signal's reason and writes nothing.
   * @returns the committed record, or the unchanged current one.
   */
  modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    options?: NativeCredentialWriteOptions,
  ): Promise<CredentialRecord | undefined>
  /**
   * Remove one record under the Provider's write queue.
   * @param key - record address.
   * @param options - `signal` is checked inside the queue before the removal commits;
   *   `when` decides against the record as it stands inside the queue, so a later write is never removed.
   */
  deleteRecord(key: CredentialKey, options?: NativeCredentialDeleteOptions): Promise<void>
}
```

Source: [`rsh/Modules/Official/credentials/credentials/src/native.ts`](../../Modules/Official/credentials/credentials/src/native.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauthorization--authorizationservice"></a>

### `ctx.authorization` — `AuthorizationService`

`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.

```ts cordis-catalog
/**
 * Offer a way to obtain one credential. One flow per key: two plugins
 * claiming the same key would each write a record in their own format, and
 * whichever ran last would leave the other reading a payload it cannot parse.
 *
 * @param flow - the key it writes, its label, its methods, and its runner.
 * @returns Disposer that withdraws this flow.
 * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
 */
registerFlow(flow: AuthorizationFlow): () => void

/**
 * Every registered flow, for a surface listing what can be authorized.
 * @returns one entry per flow, in registration order.
 */
list(): readonly AuthorizationEntry[]

/**
 * One registered flow.
 * @param key - the credential record to ask about.
 * @returns the entry, or undefined when no flow claims that key.
 */
describe(key: CredentialKey): AuthorizationEntry | undefined

/**
 * Withdraw the attempt running for a key, if any. Separate from the
 * request's own signal because a request/response transport answers a Cancel
 * button on a second call, with no handle on the first one's signal.
 * @param key - the credential record whose attempt should stop.
 */
cancel(key: CredentialKey): void

/**
 * Run one attempt to authorize a key, and report how it ended.
 *
 * One attempt per key at a time. A second caller is refused rather than
 * joined: the two would be prompting different humans through the same flow,
 * and the second would answer questions the first was asked.
 *
 * @param request - the key, the method, the surface, and the cancel signal.
 * @returns `authorized` once the flow's record is committed during this
 *   attempt and observed, or `cancelled` when the human declined or the
 *   caller withdrew.
 * @throws {AuthorizationError} code `NO_FLOW` when nothing claims the key,
 *   `UNKNOWN_METHOD` when the named method is not one the flow offers,
 *   `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or
 *   `NOT_COMMITTED` when the flow resolved without committing a record
 *   during the attempt.
 */
async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>
```

Source: [`rsh/Modules/Official/credentials/authorization/src/index.ts`](../../Modules/Official/credentials/authorization/src/index.ts)

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (abstract seam)

Abstract credential service over two key spaces that answer two questions.

A CredentialRef answers "what is behind this environment-variable name", layered over the process environment, the provider-managed store, and `.env` files. One seam-wide rule binds that half: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.

A CredentialKey answers "what credential does this plugin hold for this id". Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and modifyRecord is the only write path because a correct write depends on the current value (a token refresh is read-decide-replace under one lock).

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 * @param ref - the reference to resolve.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>

/**
 * Read one stored record. The value is returned as its owner wrote it; a
 * {@link GrantRecord} payload is not interpreted on the way out.
 * @param key - the record to read.
 * @returns the record, or `undefined` while none is stored.
 */
abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>

/**
 * Read JSON metadata owned by a plugin. Metadata is stored separately from
 * credential records and never appears in {@link listRecords}.
 * @param key - owner-scoped metadata address.
 * @returns the JSON value, or `undefined` while absent.
 */
abstract readMetadata(key: CredentialKey): Promise<unknown>

/**
 * Read-decide-replace plugin-owned JSON metadata under the provider's write
 * lock. Returning `undefined` leaves the current value unchanged.
 * @param key - owner-scoped metadata address.
 * @param mutate - decides the next JSON value from the current one.
 * @returns the committed value, or the unchanged current value.
 */
abstract modifyMetadata( key: CredentialKey, mutate: (current: unknown) => Promise<unknown>, ): Promise<unknown>

/**
 * Reconcile owner metadata with a legacy credential record under the same
 * provider lock. The legacy record is removed only after metadata is durable
 * and verified. The callback receives detached metadata and legacy values
 * and can read detached sibling-record copies from that locked snapshot.
 * @param key - address shared by the old record and new metadata value.
 * @param migrate - validates detached values from the locked snapshot and chooses the durable metadata result.
 * @returns the verified metadata value.
 */
abstract migrateRecordToMetadata( key: CredentialKey, migrate: ( current: unknown, legacy: CredentialRecord | undefined, readRecord: (key: CredentialKey) => CredentialRecord | undefined, ) => Promise<CredentialMetadataMigration>, ): Promise<unknown>

/**
 * Describe one record for configuration surfaces without exposing its value.
 * @param key - the record to describe.
 * @returns presence, discriminant, and writability.
 */
abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>

/**
 * Enumerate every stored record's address and tag. Unlike the reference
 * half, which has no enumeration because configuration surfaces learn which
 * references exist from settings schemas, records have no such discovery
 * path: a surface that cannot list them cannot show what a user is
 * authorized for, nor find an orphan left by an uninstalled plugin.
 * @returns every stored record, values excluded.
 */
abstract listRecords(): Promise<readonly CredentialRecordEntry[]>

/**
 * Serialized read-modify-write over one record — the only write path.
 * `mutate` sees the record as it stands at the moment the write is
 * exclusive, and returning `undefined` leaves the entry untouched. Exclusion
 * holds across processes where the backing store supports it, which is what
 * makes a token refresh safe: two processes rotating one refresh token
 * concurrently would otherwise lose whichever wrote first.
 * @param key - the record to modify.
 * @param mutate - receives the current record and returns its replacement, or `undefined` to leave it.
 * @returns the record after the write, or the current one when `mutate` declined.
 */
abstract modifyRecord( key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>, ): Promise<CredentialRecord | undefined>

/**
 * Remove one record; removing an absent record is a no-op.
 * @param key - the record to remove.
 */
abstract deleteRecord(key: CredentialKey): Promise<void>
```

Source: [`rsh/Modules/Official/credentials/credentials/src/index.ts`](../../Modules/Official/credentials/credentials/src/index.ts)

<a id="ctxcredentialscontroller--credentialscontroller"></a>

### `ctx.credentialsController` — `CredentialsController`

Host service backing the generated `ctx.remote.credentials` namespace. It carries every wire obligation the credential seam itself does not: the batch fan-out bound, the field-by-field view projection, the reference-grammar guard, and the refusal mapping. Secret values cross in one direction only — no method here returns one.

```ts cordis-catalog
/**
 * Describe several references for one configuration surface. Batched because
 * a settings page describes every reference its rows name at once, and one
 * round trip keeps those rows from settling separately.
 * @param refs - reference names, at most {@link MAX_DESCRIBE_REFS}; a name outside the grammar
 *   rejects the whole call as `gateway/bad-request`.
 * @returns one view per requested name, keyed by that name.
 * @throws RemoteError when the request is invalid or no credential provider is mounted.
 */
@Remote async describe(refs: string[]): Promise<Record<string, CredentialInfo>>

/**
 * Store one value from a configuration surface. The value crosses the wire in
 * this direction only: no read path returns it.
 * @param ref - reference name to store under.
 * @param value - the non-empty secret value.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async set(ref: string, value: string): Promise<void>

/**
 * Remove one reference from a configuration surface.
 * @param ref - reference name to remove.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async unset(ref: string): Promise<void>
```

Source: [`rsh/Programs/Web/api/settings-controller/src/credentials.ts`](../../Programs/Web/api/settings-controller/src/credentials.ts)

<a id="authorization-events"></a>

### `authorization/*` events

<a id="authorizationsettled--emit"></a>

#### `authorization/settled` — emit

One authorization attempt has finished and released its key. Fires for every terminal outcome, failures included, so a surface watching a key it did not start (a second browser tab) learns the attempt is over.

```ts cordis-catalog
/**
 * One authorization attempt has finished and released its key. Fires for
 * every terminal outcome, failures included, so a surface watching a key it
 * did not start (a second browser tab) learns the attempt is over.
 * @mode emit
 * @param key - the credential record the finished attempt was authorizing.
 * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
 */
'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void
```

Source: [`rsh/Modules/Official/credentials/authorization/src/index.ts`](../../Modules/Official/credentials/authorization/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` events

<a id="credentialsrecord-updated--emit"></a>

#### `credentials/record-updated` — emit

Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage. Separate from `credentials/reference-updated` because the two key grammars are disjoint — a listener that received both on one event could not tell which space a subject belongs to. Listener failures are contained on the same terms as `credentials/reference-updated`.

```ts cordis-catalog
/**
 * Committed change to a stored credential record: a `modifyRecord` that
 * wrote, a `deleteRecord` that removed, or an external edit observed in
 * storage. Separate from `credentials/reference-updated` because the two key
 * grammars are disjoint — a listener that received both on one event could
 * not tell which space a subject belongs to. Listener failures are
 * contained on the same terms as `credentials/reference-updated`.
 * @param key - the record whose stored value changed.
 * @mode emit
 */
'credentials/record-updated'(key: CredentialKey): void
```

Source: [`rsh/Modules/Official/credentials/credentials/src/types.ts`](../../Modules/Official/credentials/credentials/src/types.ts)

<a id="credentialsreference-updated--emit"></a>

#### `credentials/reference-updated` — emit

Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners, so
 * invariant checks on this event must not be async functions.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/reference-updated'(ref: CredentialRef): void
```

Source: [`rsh/Modules/Official/credentials/credentials/src/types.ts`](../../Modules/Official/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
