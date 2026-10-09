# 会话查询

[English](session-query.md) | 中文

本文定义逻辑会话语料库的查询词汇；当 live 数据存在时，该语料库优先使用 live 数据。[Service Definition 包](../../Engine/session-query/session-query)负责精确读取、来源优先级、关系追踪、语义提取，以及与提供方无关的过滤器；[SQLite 提供方](../../Engine/session-query/session-query-sqlite)负责具体全文索引的生命周期。

Cordis-free Native 入口通过同一个 `sessionQuery` 服务键发布相同的 `SessionQueryOperations`。它从 `activeSessions` 读取活动历史，并从可选的 `sessionPersistence` 读取冷历史；驻留 Session 校验活动历史，脱离运行时的冷日志则在不取得 writer 的前提下通过回放校验。Native runtime 提供精确读取、观察租约、过滤器、事件窗口与关系追踪。选定 SQLite 提供方后，会在同一组已捕获来源上增加排序搜索；未选择搜索提供方时，搜索以 `SESSION_QUERY_SEARCH_DISABLED` 失败。

```ts type-equiv
/** Compatibility name for Native consumers of the shared service Definition. */
type NativeSessionQueryOperations = SessionQueryOperations
```

源码：[`rsh/Engine/session-query/session-query/src/native.ts`](../../Engine/session-query/session-query/src/native.ts)

## 逻辑记录

`SessionRecord` 由全语料库列表返回。它除了克隆的、优先取自 live 源的 header 外，还单独公开各源的可用性。`SessionEventRecord` 是轻量的原始日志投影；分类使用与模型历史推导相同的 `foldSurface()` 状态转换。

```ts type-equiv
/** Whether an event is current model context, replaced context, or raw-log-only. */
type SessionEventSurface = 'current' | 'shadowed' | 'log-only'
```

```ts type-equiv
/** Lightweight identity and source availability for one logical session. */
interface SessionRecord {
  /** Cloned session header selected from the live-preferred corpus. */
  header: SessionHeader
  /** Whether the id currently exists in the selected runtime's live session authority. */
  live: boolean
  /** Whether the active persistence backend currently lists the id, including a created-but-unmaterialized session it already observes. */
  persisted: boolean
}
```

`SessionLogSnapshot` 是供恢复预检使用的完整脱离运行时原始日志；冷持久化日志会在内存中补齐尾部并通过脱离运行时的回放验证。`SessionSurfaceSnapshot` 表示一次精确读取的 surface 观测结果，而不是持续保留的订阅。

```ts type-equiv
/** One detached observation of a logical session's complete raw log. */
interface SessionLogSnapshot {
  /** Cloned session header selected from the same observation as `events`. */
  session: SessionHeader
  /** Exact number of fork-inherited events in the observed log. */
  inheritedEventCount: SessionLogOffset
  /** Cloned contiguous raw events; cold persisted logs include in-memory tail balancing and detached replay validation. */
  events: SessionEvent[]
}
```

```ts type-equiv
/** One atomic live-preferred observation of a session's current model surface. */
interface SessionSurfaceSnapshot {
  /** Cloned session header selected from the same corpus observation as `events`. */
  session: SessionHeader
  /** Exact number of fork-inherited events in the observed log. */
  inheritedEventCount: SessionLogOffset
  /** Highest raw-log seq included in the observation, or `null` for an empty log. */
  capturedThroughSeq: OptionalSessionSeq
  /** Cloned current surface events in model-history order. */
  events: SurfaceEvent[]
}
```

`SessionTitleObservation` 将同样的原子观测规则应用于标题折叠，使执行授权检查的消费方能够验证提供标题的源 header。批量读取会按顺序为每个唯一请求 id 返回一个 `SessionTitleObservationResult`：操作失败只影响对应 id，而取消会拒绝整个操作。

```ts type-equiv
/** Latest folded title bound to the same session-header observation. */
interface SessionTitleObservation {
  /** Cloned header selected with the event log used for the title fold. */
  session: SessionHeader
  /** Latest title snapshot, absent when the observed log has no title. */
  title?: SessionTitleSnapshot
}
```

```ts type-equiv
/** One ordered result from a batch title observation. */
type SessionTitleObservationResult =
  | {
    /** Requested session id. */
    sessionId: SessionId
    /** Successful atomic header/title observation. */
    status: 'fulfilled'
    /** Header and optional latest title from one logical source. */
    value: SessionTitleObservation
  }
  | {
    /** Requested session id. */
    sessionId: SessionId
    /** Operational failure isolated to this session. */
    status: 'rejected'
    /** Original failure from logical-source resolution or title folding. */
    reason: unknown
  }
```

```ts type-equiv
/** Lightweight metadata for one event within a logical session. */
interface SessionEventRecord {
  /** Session that owns the event. */
  sessionId: SessionId
  /** Monotonic event seq within the session. */
  seq: SessionSeq
  /** Discriminant of the session event. */
  type: SessionEventType
  /** Event timestamp in Unix epoch milliseconds. */
  time: number
  /** Event placement in the folded session surface. */
  surface: SessionEventSurface
}
```

## 与提供方无关的过滤器和文档

会话和事件过滤器数组内的各项按逻辑与（AND）组合；单个列表子句中的各值按逻辑或（OR）组合。范围包含两端。事件的 `text` 子句会对提取出的语义文本执行正则表达式扫描：搜索文本按字面量处理，按 Unicode 规则执行不区分大小写的匹配，并允许灵活匹配空白字符；该过程与全文搜索提供方无关。

```ts type-equiv
/**
 * One logical-session predicate. A filter array is ANDed; `values` within a
 * clause are ORed.
 */
type SessionResultFilter =
  | { kind: 'id'; values: readonly SessionId[] }
  | { kind: 'cwd'; values: readonly (string | null)[] }
  | ({ kind: 'created-at' } & SessionResultRange)
  | { kind: 'parent'; values: readonly (SessionId | null)[] }
  | { kind: 'availability'; values: readonly SessionAvailability[] }
```

```ts type-equiv
/**
 * One event predicate. A filter array is ANDed; list-valued clauses are ORed.
 * Text is a literal, case-insensitive, whitespace-flexible semantic-text scan.
 */
type SessionEventResultFilter =
  | ({ kind: 'seq' } & SessionResultRange)
  | ({ kind: 'time' } & SessionResultRange)
  | { kind: 'type'; values: readonly SessionEventType[] }
  | { kind: 'surface'; values: readonly SessionEventSurface[] }
  | { kind: 'text'; text: string }
```

```ts type-equiv
/** Searchable semantic document derived from one session event. */
interface SessionEventSearchDocument extends SessionEventRecord {
  /** First-party semantic text used by scan filters and full-text indexes. */
  text: string
}
```

`ctx.sessionQuery.filterSessions(filters)` 会对完整的逻辑会话语料库应用 `SessionResultFilter`；`ctx.sessionQuery.filterEvents(sessionId, filters)` 按 seq 升序返回匹配的文档。消息、工具调用和工具结果、待办事项，以及失败和状态详情会纳入语义文本；推理（reasoning）块、被阻止的提示词、结构事件和流分片则不会。

## 全文搜索结果页

整合后的 `ctx.sessionQuery` seam 提供两个全文搜索范围。`searchSessions()` 按匹配度最强的事件对语料库分组；`searchEvents()` 搜索单个会话。请求将不透明游标与规范化后的查询、元数据过滤器和结果数量上限绑定。提供方的元数据过滤器有意不包含事件文本扫描。

```ts type-equiv
/** Provider-owned opaque continuation token returned by session search. */
type SessionSearchCursor = Branded<'SessionSearchCursor'>
```

```ts type-equiv
/** Cross-session full-text search request. */
interface SessionSearchRequest {
  /** Full-text query interpreted as data, never executable FTS syntax. */
  query: string
  /** Logical-session predicates applied before event ranking. */
  sessionFilters?: readonly SessionResultFilter[]
  /** Event predicates applied before event ranking. */
  eventFilters?: readonly SessionEventMetadataFilter[]
  /** Maximum sessions in this page. */
  limit?: number
  /** Opaque cursor returned for the identical normalized request. */
  cursor?: SessionSearchCursor
}
```

```ts type-equiv
/** Within-session full-text search request. */
interface SessionEventSearchRequest {
  /** Session whose live-preferred logical log is searched. */
  sessionId: SessionId
  /** Full-text query interpreted as data, never executable FTS syntax. */
  query: string
  /** Event predicates applied before ranking. */
  filters?: readonly SessionEventMetadataFilter[]
  /** Maximum events in this page. */
  limit?: number
  /** Opaque cursor returned for the identical normalized request. */
  cursor?: SessionSearchCursor
}
```

```ts type-equiv
/** One cursor-paginated result page. */
interface SessionSearchPage<T> {
  /** Results for this page in contract-defined order. */
  items: readonly T[]
  /** Opaque continuation cursor, absent on the final page. */
  nextCursor?: SessionSearchCursor
}
```

与跨会话分组 hit 不同，会话内搜索结果即使没有命中项，也必须公开搜索时观测到的目标 header。

```ts type-equiv
/** Event-search results bound to the indexed target-session observation. */
interface SessionEventSearchPage extends SessionSearchPage<SessionEventSearchHit> {
  /** Cloned target header from the same indexed generation as `items`. */
  session: SessionHeader
}
```

```ts type-equiv
/** One event full-text search hit with a bounded plain-text excerpt. */
interface SessionEventSearchHit extends SessionEventRecord {
  /** Plain text excerpt selected around the match. */
  snippet: string
}
```

```ts type-equiv
/** One grouped cross-session hit, ranked by its strongest matching event. */
interface SessionSearchHit extends SessionRecord {
  /** Strongest matching event for this session. */
  bestMatch: SessionEventSearchHit
}
```

## 会话谱系

`SessionLineageTrace` 按由近及远的顺序携带已知 parent，以及由直接 descendant 递归嵌套而成的森林。完整性判别字段使已知 root 与缺失 parent 互斥。

```ts type-equiv
/** Recursive descendant node in a session-lineage trace. */
interface SessionLineageNode {
  /** Detached logical-corpus record for this descendant. */
  session: SessionRecord
  /** Direct children, each carrying its own recursive descendants. */
  descendants: SessionLineageNode[]
}
```

```ts type-equiv
/** Known ancestry and descendants for one logical session. */
type SessionLineageTrace = {
  /** Detached record for the session that was traced. */
  target: SessionRecord
  /** Known parents from the immediate parent outward. */
  ancestors: SessionRecord[]
  /** Complete known descendant trees rooted at the target's direct children. */
  descendants: SessionLineageNode[]
} & (
  | {
    /** The complete parent chain is present in the logical corpus. */
    complete: true
    /** Detached record at the top of the complete lineage. */
    root: SessionRecord
  }
  | {
    /** The parent chain leaves the visible logical corpus. */
    complete: false
    /** First parent id that is not present in the logical corpus. */
    unresolvedParentId: SessionId
  }
)
```

## 有界事件读取

请求指定一个原始 seq 及可选的邻近数量。结果携带 `SessionHeader` 而非可用性标志，使已知的 live 目标可以独立于持久化健康状态。

```ts type-equiv
/** Request for one event plus raw neighboring log context. */
interface SessionEventReadRequest {
  /** Session that owns the target event. */
  sessionId: SessionId
  /** Target event seq. */
  seq: SessionSeq
  /** Number of preceding raw events to include. */
  before?: number
  /** Number of following raw events to include. */
  after?: number
}
```

```ts type-equiv
/** Full target event and a bounded raw-log window. */
interface SessionEventWindow {
  /** Cloned header for the live-preferred source read. */
  session: SessionHeader
  /** Exact number of fork-inherited events in the observed log. */
  inheritedEventCount: SessionLogOffset
  /** Full cloned target event. */
  target: SessionEvent
  /** Full cloned events from `startSeq` through `endSeq`. */
  events: SessionEvent[]
  /** First seq included in `events`. */
  startSeq: SessionSeq
  /** Last seq included in `events`. */
  endSeq: SessionSeq
}
```

## 事件关系

事件追踪会区分位置替换与被引用为来源的事件。除 `replacementChain` 外，每个 seq 列表都只包含直接链接；该链从目标沿直接 replacer 追踪到最终的位置替换。

```ts type-equiv
/** Request for direct surface replacements and relationships to cited source events around one event. */
interface SessionEventTraceRequest {
  /** Session that owns the target event. */
  sessionId: SessionId
  /** Target event seq. */
  seq: SessionSeq
}
```

```ts type-equiv
/** Direct surface replacements and relationships to cited source events for one event. */
interface SessionEventTrace {
  /** Lightweight target record. */
  target: SessionEventRecord
  /** Immediate positional replacement event, when the target was shadowed. */
  replacedBy?: SessionSeq
  /** Positional replacers from the immediate replacement to the final replacement. */
  replacementChain: SessionSeq[]
  /** Surface nodes directly removed when the target itself performed a replacement. */
  replacedEventSeqs: SessionSeq[]
  /** Earlier events cited directly as sources, in their recorded order. */
  sourceEventSeqs: SessionSeq[]
  /** Later events that directly cite the target as a source, in log order. */
  derivedEventSeqs: SessionSeq[]
}
```

```ts type-equiv
/** Event relationships bound to the same session-header observation. */
interface SessionEventTraceObservation extends SessionEventTrace {
  /** Cloned header selected with the event log used for the trace. */
  session: SessionHeader
}
```

## 错误

封闭的 code 联合类型区分请求校验、目标缺失、surface 日志格式错误、可选后端故障、部署关闭搜索与矛盾的源元数据。

```ts type-equiv
/** Stable machine-routable failure taxonomy for session reads, traces, and search. */
type SessionQueryErrorCode =
  | 'SESSION_QUERY_ABORTED'
  | 'SESSION_QUERY_CORRUPT_SESSION'
  | 'SESSION_QUERY_EVENT_NOT_FOUND'
  | 'SESSION_QUERY_INDEX_FAILED'
  | 'SESSION_QUERY_INVALID_CONFIG'
  | 'SESSION_QUERY_INVALID_CURSOR'
  | 'SESSION_QUERY_INVALID_FILTER'
  | 'SESSION_QUERY_INVALID_LIMIT'
  | 'SESSION_QUERY_INVALID_QUERY'
  | 'SESSION_QUERY_INVALID_LINEAGE'
  | 'SESSION_QUERY_INVALID_SURFACE'
  | 'SESSION_QUERY_INVALID_WINDOW'
  | 'SESSION_QUERY_PERSISTENCE_FAILED'
  | 'SESSION_QUERY_PROVIDER_CLOSED'
  | 'SESSION_QUERY_SEARCH_DISABLED'
  | 'SESSION_QUERY_SESSION_NOT_FOUND'
  | 'SESSION_QUERY_STALE_CURSOR'
  | 'SESSION_QUERY_SOURCE_CONFLICT'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionquery--sessionqueryoperations"></a>

### `ctx.sessionQuery` — `SessionQueryOperations`

Full logical-corpus service implemented by exactly one selected Provider.

```ts cordis-catalog
/**
 * Observe one exact live or prepared Session without a persistence listing preflight.
 * @param sessionId - logical Session identity.
 * @param options - cancellation and projection selection.
 * @returns a caller-owned observation lease.
 */
observeSession(sessionId: SessionId, options?: SessionObservationOptions): Promise<SessionObservation>

/**
 * Search the live-preferred logical corpus and group by session.
 * @param request - query text, filters, page size, and cursor.
 * @param exec - optional cancellation control.
 * @returns session hits ranked by their strongest matching event.
 */
searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>

/**
 * Search events within one live-preferred logical session.
 * @param request - target session, query text, filters, page size, and cursor.
 * @param exec - optional cancellation control.
 * @returns matching events and their target header from one index generation.
 */
searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage>

/**
 * List the complete logical corpus using live-preferred records.
 * @param signal - optional cancellation for persistence listing.
 * @returns deterministic newest-first cloned session records.
 */
listSessions(signal?: AbortSignal): Promise<SessionRecord[]>

/**
 * Read one complete logical session without making it live. Detached logs are replay-validated;
 * live history comes from the active owner's validated resident Session.
 * @param sessionId - live or persisted session id to read.
 * @param signal - optional cancellation for source resolution and reading.
 * @returns cloned header and complete raw event log from one observation.
 */
readSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLogSnapshot>

/**
 * Filter the complete logical corpus with provider-independent predicates.
 * @param filters - ANDed session metadata and availability clauses.
 * @param signal - optional cancellation for persistence listing.
 * @returns matching cloned records in deterministic newest-first order.
 */
filterSessions(filters: readonly SessionResultFilter[], signal?: AbortSignal): Promise<SessionRecord[]>

/**
 * Read only the latest log-backed title.
 * @param sessionId - live or persisted session id to read.
 * @param signal - optional cancellation for source resolution.
 * @returns the latest title snapshot, or `undefined` when absent.
 */
readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>

/**
 * Read the latest log-backed title together with its source header.
 * @param sessionId - live or persisted session id to read.
 * @param signal - optional cancellation for source resolution.
 * @returns the source header and optional title snapshot.
 */
readTitleSnapshot(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleObservation>

/**
 * Read titles for unique sessions in first-occurrence order, isolating per-session failures.
 * @param sessionIds - logical session ids to observe.
 * @param signal - optional cancellation shared by all source reads.
 * @returns one fulfilled or rejected result per unique requested id.
 */
readTitleSnapshots(sessionIds: readonly SessionId[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]>

/**
 * List lightweight event records in ascending sequence order.
 * @param sessionId - live-preferred session id to read.
 * @returns one record per raw event.
 */
listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>

/**
 * Scan semantic event documents with provider-independent filters.
 * @param sessionId - live-preferred session id to scan.
 * @param filters - ANDed metadata and literal-text predicates.
 * @returns matching semantic documents in ascending sequence order.
 */
filterEvents(sessionId: SessionId, filters: readonly SessionEventResultFilter[]): Promise<SessionEventSearchDocument[]>

/**
 * Read the complete current model surface from one corpus observation.
 * @param sessionId - live-preferred session id to read.
 * @returns cloned header, surface, and captured raw-log watermark.
 */
readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>

/**
 * Trace known ancestry and descendants from one corpus observation.
 * @param sessionId - logical session id to trace.
 * @param signal - optional cancellation for persistence listing.
 * @returns complete lineage or the first unresolved parent.
 */
traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace>

/**
 * Trace one event's direct positional replacements and cited source events.
 * @param request - target session id and event sequence.
 * @param signal - optional cancellation for source resolution.
 * @returns source header, direct links, and positional replacement chain.
 */
traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation>

/**
 * Read one full event and a bounded raw-log context window.
 * @param request - target session/sequence and context sizes.
 * @param signal - optional cancellation for source resolution.
 * @returns cloned target and neighboring raw events.
 */
readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>
```

Types: [SessionId](core.zh.md) · [SessionTitleSnapshot](session-title.zh.md)

Source: [`rsh/Engine/session-query/session-query/src/definition.ts`](../../Engine/session-query/session-query/src/definition.ts)
<!-- END GENERATED cordis-surface -->
