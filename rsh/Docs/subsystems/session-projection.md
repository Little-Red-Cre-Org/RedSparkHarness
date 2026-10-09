# Session Projections

English | [中文](session-projection.zh.md)

The session-projection seam — a [capability seam](../capability-seams.md) through which domain host plugins serve whole current values of log-derived per-session state to client carriers: the Service Definition and registry ([dsh-session-projection](../../Engine/session/session-projection), `ctx.sessionProjections`), domain contributors (each registering one pure unit), and carriers ([dsh-session-controller](../../Programs/Web/api/session-controller)'s history tail page and `session/projection` push frame). It is one optional capability, not part of the agent-loop spine. The framework drives, the domain computes: the registry subscribes to `session/event` once and folds every committed event through every unit; domains hold no subscriptions and clients never fold domain events — they receive finished values. Design authority: the [session-projection RFC](../../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md); drive/cache/feed contracts: the [package README](../../Engine/session/session-projection/README.md).

Source: [Projection definition](../../Engine/session/session-projection/src/definition.ts) · [Cordis registry](../../Engine/session/session-projection/src/index.ts) · [Native registry](../../Engine/session/session-projection/src/native.ts)

## The unit

`SessionProjectionStateMap` is the merge-extensible table of host fold states, while `SessionProjectionMap` retains the client-visible whole values. A domain contributes one `ProjectionDefinition` per state key; a `wire` block makes that key client-visible, and rendering belongs to the slot system, never this layer:

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

The whole-value event rule is load-bearing: a state-carrying log event carries the complete post-change state, never a bare delta — it keeps every transition trivially cheap and every served value self-describing (last-wins for consumers).

## The snapshot and the change feed

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

`snapshot(session)` is fully synchronous: a carrier reads it in the same tick as its page slice, so `asOfSeq` covers both reads at one sequence number. It returns only client views, and every value passes its unit's `viewSchema` before return. `stateOf(session, key)` reads one live host state without computing unrelated views; callers must not mutate the borrowed reference. A state-reference change computes one cached raw view, and the change feed fires only when that result changes by `Object.is`; an object-valued view must preserve its reference to suppress publication across internal-only state changes.

The registry reports a throwing change-feed listener and continues the remaining listeners and projection units for the committed event.

## The registry: `ctx.sessionProjections`

`SessionProjectionRegistry` ([signatures](#ctxsessionprojections--sessionprojectionregistry)) owns the drive: one `session/event` subscription, eager `apply` over every registered unit, and per-session per-unit watermark cells. Cells build lazily — a unit registered after events flowed, or a session older than the registry, folds `init` over the in-memory log on first touch (event or read). Registration is an effect whose disposer rides the calling fiber: an unloaded domain plugin's key (with its cached cells) disappears from subsequent drives and snapshots, and clients read that as capability absence; a duplicate key with a different `stateVersion` throws, while same-version registrants share one unit and are counted. Domain plugins register under `ctx.inject(['sessionProjections'], …)` so headless assemblies without the registry stay unaffected.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Session](session.md) · [SessionEvent](session.md) · [SessionHeader](persistence.md) · [SessionLogOffset](session.md)

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

Types: [Session](session.md) · [SessionEvent](session.md) · [SessionHeader](persistence.md) · [SessionLogOffset](session.md)

Source: [`rsh/Engine/session/session-projection/src/index.ts`](../../Engine/session/session-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
