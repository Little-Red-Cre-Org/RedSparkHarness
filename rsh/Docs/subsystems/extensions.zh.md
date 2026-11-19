# 扩展

[English](extensions.md) | 中文

extensions 子系统说明 [`inspector`](../../Modules/Community/experimental/inspector/README.zh.md) 服务：它回答针对运行中 Host 的 service、event、tool、slot 与主题 token 的只读查询。动态包定义与挂载工具已退役；包含其工具调用的已记录 Session 仍会通过通用工具行回放。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxinspector--inspectorservice"></a>

### `ctx.inspector` — `InspectorService`

Shared Host/Client service façade over the realm's source publisher.

```ts cordis-catalog
/**
 * Publish one JSON observation without waiting for Worker delivery.
 * @param topic - Domain-owned topic name.
 * @param payload - JSON value validated before it reaches the carrier.
 * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
 */
publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
```

Source: [`rsh/Modules/Community/experimental/inspector/src/index.ts`](../../Modules/Community/experimental/inspector/src/index.ts)
<!-- END GENERATED cordis-surface -->
