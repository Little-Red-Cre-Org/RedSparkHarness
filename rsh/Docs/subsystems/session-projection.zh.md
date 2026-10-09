# 会话投影

[English](session-projection.md) | 中文

会话投影 seam 是一项[能力 seam](../capability-seams.zh.md)：领域 host 插件经由它向客户端载体供给按会话的日志派生状态的当前全量值；三方分别是 Service Definition 与注册表（[dsh-session-projection](../../Engine/session/session-projection)，`ctx.sessionProjections`）、领域贡献方（每个领域注册一个纯单元）与载体（[dsh-session-controller](../../Programs/Web/api/session-controller) 的历史尾页与 `session/projection` 推送帧）。它是一项可选能力，不属于 agent loop（智能体循环）主干。框架负责驱动，领域负责计算：注册表只订阅一次 `session/event`，并把每个已提交事件折叠进每个单元；领域不持有任何订阅，客户端也从不折叠领域事件——它们收到的是成品值。设计权威：[session-projection RFC](../../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.zh.md)；驱动、缓存与变更流约定：[包 README](../../Engine/session/session-projection/README.zh.md)。

源码：[投影 Definition](../../Engine/session/session-projection/src/definition.ts) · [Cordis 注册表](../../Engine/session/session-projection/src/index.ts) · [Native 注册表](../../Engine/session/session-projection/src/native.ts)

## 投影单元

`SessionProjectionStateMap` 是 host 侧折叠状态的 merge-extensible 类型表，`SessionProjectionMap` 则继续表示客户端可见的全量值。领域为每个状态 key 贡献一个 `ProjectionDefinition`；`wire` 块使该 key 对客户端可见，渲染归 slot 体系管，永远不归本层：

```ts type-equiv
/**
 * One domain's synchronous projection unit. The registry applies each committed
 * event to its state; domain code owns no subscriptions or Session lifecycle.
 * State must be plain JSON for checkpoints, and an unrelated event must return
 * the same state reference so the registry can skip downstream work.
 */
interface ProjectionDefinition<
  K extends keyof SessionProjectionStateMap,
  S extends SessionProjectionStateMap[K] = SessionProjectionStateMap[K],
> {
  /** The key owned in the merge-extensible state table. */
  key: K
  /** Validates persisted state before it seeds a fold or a whole client view. */
  stateSchema: ZodType<S>
  /**
   * State for the empty log and its immutable Session metadata.
   * @param header - immutable metadata for the Session being projected.
   * @param inheritedEventCount - exact fork-inherited prefix length.
   * @returns the initial state.
   */
  init(header: SessionHeader, inheritedEventCount: SessionLogOffset): NoInfer<S>
  /**
   * Pure transition from one committed event. An unaffected unit MUST return
   * the same state reference; changed references invalidate its cached view.
   * @param state - state covering all prior events.
   * @param event - the next accepted session event.
   * @returns next state, or the same reference when unaffected.
   */
  apply(state: NoInfer<S>, event: SessionEvent): NoInfer<S>
  /** Client view. Omit for host-only units. */
  wire?: K extends keyof SessionProjectionMap ? {
    /** Validates the wire payload before it leaves the host. */
    viewSchema: ZodType<SessionProjectionMap[K]>
    /**
     * Projects internal state to a whole client-visible value. Reuse the same
     * reference when the visible value has not changed; the registry compares
     * successive views with `Object.is`.
     * @param state - the current state.
     * @returns the complete value for this projection key.
     */
    view(state: NoInfer<S>): SessionProjectionMap[K]
  } : never
  /**
   * Non-negative cache version. Bump when serialized state or fold semantics
   * change so old checkpoint rows are discarded instead of forward-applied.
   */
  stateVersion: number
}
```

全量值事件规则是承重结构：携带状态的日志事件携带的是变更后的完整状态，绝不是裸增量——这让每次状态转移始终足够廉价，也让每个被供给的值自描述（对消费方即 last-wins）。

## 快照与变更流

```ts type-equiv
/**
 * One consistent read cut over every registered client-visible unit for one session.
 * `asOfSeq` is the shared watermark — the seq of the last event every value
 * reflects (`-1` for an empty log).
 */
interface ProjectionSnapshot {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: SessionSeqCursor
  /** Whole current client value per registered key. */
  values: Partial<SessionProjectionMap>
}
```

```ts type-equiv
/**
 * Change-feed listener: one unit's raw `view` result changed by `Object.is`
 * for one session. `value` is the schema-validated output; `seq` is the
 * unit's watermark at emission (the seq of the event that caused the change).
 */
type ProjectionChangeListener = (
  session: Session,
  key: Extract<keyof SessionProjectionMap, string>,
  value: unknown,
  seq: SessionSeq,
) => void
```

`snapshot(session)` 完全同步：载体在切出页面切片的同一 tick 内读取它，因此 `asOfSeq` 使两次读取使用同一个序号。它只返回客户端视图，并在返回前通过各单元的 `viewSchema` 校验。`stateOf(session, key)` 可在不计算无关视图的情况下读取一份实时 host 状态；调用方不得修改这一借用引用。state 引用变化时，注册表计算并缓存一次原始 view；只有该结果通过 `Object.is` 判定为变化时才触发变更流，对象 view 若要在仅内部 state 变化时抑制发布就必须保留引用。

若变更流监听器抛出异常，注册表会报告该异常，并继续通知其余监听器和驱动本次已提交事件的投影单元。

## 注册表：`ctx.sessionProjections`

`SessionProjectionRegistry`（[签名](#ctxsessionprojections--sessionprojectionregistry)）拥有驱动权：一份 `session/event` 订阅、对每个已注册单元即时调用 `apply`，以及每会话每单元的水位线（watermark）cell。cell 惰性构建：在事件流过之后才注册的单元，或比注册表更早的会话，都在首次触达（事件或读取）时从 `init` 出发在内存日志上折叠。注册是一个 effect，其 disposer 随调用方 fiber 走：领域插件卸载后，其 key（连同缓存的 cell）从后续驱动与快照中消失，客户端将其读作能力缺失；key 以不同 `stateVersion` 重复时直接 throw，同版本注册方则共享一个单元并被计数。领域插件在 `ctx.inject(['sessionProjections'], …)` 下注册，因此不带注册表的 headless 组装完全不受影响。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionprojectioncache--sessionprojectioncache"></a>

### `ctx.sessionProjectionCache` — `SessionProjectionCache`

The persisted projection cache service. Opens the `session_projcache` domain at init, checkpoints live sessions on a throttled write-behind (count/interval triggers from Config) plus three mandatory points — session creation, `turn/end`, and session disposal (the live-to-cold moment) — and serves the cached rows for a session header. Every durable write is fail-soft: failures log a warning and the cache self-heals on the next write.

```ts cordis-catalog
/**
 * The zero-I/O listing read: whole values viewed straight from the stored
 * rows (version-matching keys only), each cut carried with its watermark so
 * a client value store can seed under its higher-seq-wins rule — as stale
 * as the last durable checkpoint but never wrong, and never from an
 * unrelated log (the caller's header is the identity witness). Fresher
 * paths (the history tail baseline) supersede these values whenever a
 * session is actually opened.
 * @param meta - the listed session's header (identity witness; no log read).
 * @param inheritedEventCount - exact inherited prefix length that completes
 * the checkpoint identity.
 * @param keys - optional projection keys required by the caller's audience.
 * @returns the cut (`asOfSeq` = lowest served-row watermark), or
 *   `undefined` when no usable row exists for this lifecycle.
 */
cachedSnapshot( meta: SessionHeader, inheritedEventCount: SessionLogOffset, keys?: readonly Extract<keyof SessionProjectionMap, string>[], ): ProjectionSnapshot | undefined

/**
 * Read only a predecessor checkpoint's title as a zero-I/O listing hint.
 *
 * The authoritative Session header supplies the lifecycle identity. A cache
 * checkpoint can lag that log but cannot lead it because writes flush the
 * log first, so a matching predecessor title is a genuine (possibly stale)
 * fact from this Session. The registry still requires the current title
 * projection's row version and schema. No other predecessor projection is
 * exposed: format normalization can change their current meaning, and the
 * strict {@link cachedSnapshot} / hydration paths continue to reject them.
 * @param meta - authoritative listed Session header.
 * @param inheritedEventCount - exact inherited cut completing the lifecycle identity.
 * @returns a title-only checkpoint view with `asOfSeq: -1`, or `undefined`
 *   when the record is current, newer, unrelated, missing, or incompatible
 *   with the title unit. The sentinel avoids reusing a sequence that a
 *   cardinality-changing Session migration may have remapped.
 */
cachedPredecessorTitle( meta: SessionHeader, inheritedEventCount: SessionLogOffset, ): ProjectionSnapshot | undefined

/**
 * Hydrate projection cells for an already-prepared Session without another
 * persistence read. The cache seeds matching rows; the supplied exact log
 * advances every unit to the observation cut. No checkpoint is written
 * because the logical observation may contain recovery events not yet durable.
 * @param session - exact unpublished Session retained by persistence.
 * @param events - exact logical event prefix represented by the observation.
 * @returns all projection values at the event cut.
 */
hydratePrepared( session: Session, events: readonly SessionEvent[], ): ProjectionSnapshot

/**
 * Durably checkpoint one live session NOW (all mandatory points call
 * this; tests and carriers may too). The registry cut is snapshotted at
 * this boundary (states are live references), then the session's record is
 * replaced on the domain's write chain. NOT fail-soft — callers on the
 * fail-soft paths contain it.
 * @param session - the live session to checkpoint.
 * @returns resolution after durability and event emission.
 */
async write(session: Session): Promise<void>

/**
 * Cold-read one session's projections from its complete log. Each unit is
 * seeded from the identity-checked cached rows — the registry skips `apply`
 * for the already-folded prefix (events at or below the row's `seq`) — and
 * the refreshed checkpoint is written back (fail-soft, fire-and-forget), so
 * the first cold read creates the cache row and later ones seed from it.
 * The caller supplies the complete log in seq order: this service never
 * consults the persistence layer.
 * @param meta - the stored session header (identity witness).
 * @param inheritedEventCount - exact inherited prefix length for projection initialization and identity.
 * @param events - the session's complete log, in seq order.
 * @returns the projection cut at the log end.
 */
coldSnapshot( meta: SessionHeader, inheritedEventCount: SessionLogOffset, events: readonly SessionEvent[], ): ProjectionSnapshot
```

Types: [Session](session.zh.md) · [SessionEvent](session.zh.md) · [SessionHeader](persistence.zh.md) · [SessionLogOffset](session.zh.md)

Source: [`rsh/Engine/session/session-projection-cache/src/index.ts`](../../Engine/session/session-projection-cache/src/index.ts)

<a id="ctxsessionprojections--sessionprojectionregistry"></a>

### `ctx.sessionProjections` — `SessionProjectionRegistry`

Cordis service that owns registrations and delegates projection state to the shared core.

```ts cordis-catalog
/**
 * Register one domain unit as an effect on the calling Cordis fiber.
 * @param definition - key, state schema, pure unit functions, and state version.
 * @returns the disposer for this registration.
 */
register< K extends keyof SessionProjectionMap, S extends SessionProjectionStateMap[K], >( definition: Omit<ProjectionDefinition<K, S>, 'wire'> & { wire: NonNullable<ProjectionDefinition<K, S>['wire']> }, ): () => void

/**
 * Register one host-only unit as an effect on the calling Cordis fiber.
 * @param definition - key, state schema, pure unit functions, and state version.
 * @returns the disposer for this registration.
 */
register< K extends Exclude<keyof SessionProjectionStateMap, keyof SessionProjectionMap>, S extends SessionProjectionStateMap[K], >( definition: Omit<ProjectionDefinition<K, S>, 'wire'>, ): () => void

/**
 * Subscribe to changes on the calling Cordis fiber.
 * @param listener - called when a client view changes for a committed event.
 * @returns the disposer for this subscription.
 */
onChanged(listener: ProjectionChangeListener): () => void

/**
 * Read one unit's current host state after folding to the Session cursor.
 * @param session - Session whose state is read.
 * @param key - registered unit key.
 * @returns current state, or undefined when the key is absent.
 */
stateOf<K extends keyof SessionProjectionStateMap>( session: Session, key: K, ): SessionProjectionStateMap[K] | undefined

/**
 * Read all selected client values at one synchronous Session cut.
 * @param session - Session whose client values are read.
 * @param keys - optional client-visible keys to include.
 * @returns values and their common event watermark.
 */
snapshot( session: Session, keys?: readonly Extract<keyof SessionProjectionMap, string>[], ): ProjectionSnapshot

/**
 * Read only cells already materialized for a Session.
 * @param session - Session whose cached cells are read.
 * @param keys - optional client-visible keys to include.
 * @returns values at their lowest common cached cut, or undefined.
 */
cachedSnapshot( session: Session, keys?: readonly Extract<keyof SessionProjectionMap, string>[], ): ProjectionSnapshot | undefined

/**
 * Create detached checkpoint rows for every registered unit.
 * @param session - Session whose fold state is checkpointed.
 * @returns detached state rows keyed by projection key.
 */
checkpoint(session: Session): ProjectionCheckpoint

/**
 * Find the earliest stored-log offset needed to restore checkpoint rows.
 * @param checkpoint - persisted rows for one Session.
 * @returns suffix offset, or undefined when no unit is registered.
 */
restoreFloor(checkpoint: ProjectionCheckpoint): SessionLogOffset | undefined

/**
 * View usable checkpoint rows without reading a stored log.
 * @param checkpoint - persisted rows for one Session.
 * @param keys - optional client-visible keys to include.
 * @returns validated client values from usable rows.
 */
viewCheckpoint( checkpoint: ProjectionCheckpoint, keys?: readonly Extract<keyof SessionProjectionMap, string>[], ): Partial<SessionProjectionMap>

/**
 * Restore a detached stored-log cut and return refreshed checkpoint rows.
 * @param checkpoint - persisted rows for one Session.
 * @param events - stored events beginning at baseSeq.
 * @param baseSeq - sequence of the first supplied event.
 * @param header - immutable metadata for the Session.
 * @param inheritedEventCount - exact inherited prefix length.
 * @returns snapshot and refreshed checkpoint at the supplied cut.
 */
restore( checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: SessionLogOffset, header: SessionHeader, inheritedEventCount: SessionLogOffset, ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }

/**
 * Install an exact prepared Session cut into the live projection cells.
 * @param session - prepared Session that owns the supplied event cut.
 * @param checkpoint - persisted rows for this Session lifecycle.
 * @param events - exact events at the observation cut.
 * @param baseSeq - sequence of the first supplied event.
 * @returns all client values at the supplied cut.
 */
hydrate( session: Session, checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: SessionLogOffset, ): ProjectionSnapshot
```

Types: [Session](session.zh.md) · [SessionEvent](session.zh.md) · [SessionHeader](persistence.zh.md) · [SessionLogOffset](session.zh.md)

Source: [`rsh/Engine/session/session-projection/src/index.ts`](../../Engine/session/session-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
