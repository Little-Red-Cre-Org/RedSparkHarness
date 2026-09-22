---
description: "ctx.pluginHost 注册表：RSH 插件描述符与旧式 Cordis adapter 生命周期。"
kind: "subsystem"
---

# 插件宿主子系统

[English](plugin-host.md) | 中文

## 概述

`ctx.pluginHost` 在 adapter 所有的 Cordis Fiber 运行期间记录活动 RSH 包描述符。描述符命名包、RSH runtime API 修订、角色和能力域。注册表拒绝重复包所有权，并随 adapter Fiber 释放描述符。它不选择插件代码、不替换 Cordis Loader、不包装服务或事件，也不沙箱插件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpluginhost--rshpluginhost"></a>

### `ctx.pluginHost` — `RshPluginHost`

Owns declared RSH plugin identities and adapts legacy Cordis plugins without replacing Cordis services, events, Loader configuration, or fiber lifecycle.

```ts cordis-catalog
/**
 * Reserve a descriptor while its owner is mounted.
 * @param descriptor - declared RSH ownership facts.
 * @returns an idempotent disposer that releases the reservation.
 */
register(descriptor: RshPluginDescriptor): () => void

/**
 * Return the current descriptor for one package.
 * @param packageName - full npm package name.
 * @returns the descriptor, or undefined when no owner is active.
 */
get(packageName: string): RshPluginDescriptor | undefined

/**
 * List active descriptors in stable package-name order.
 * @returns every descriptor currently reserved by a mounted adapter.
 */
entries(): readonly RshPluginDescriptor[]
```

Source: [`rsh/Core/runtime-diagnostics/plugin-host/src/index.ts`](../../Core/runtime-diagnostics/plugin-host/src/index.ts)
<!-- END GENERATED cordis-surface -->

## 模型体验

无。注册表既不改变模型请求，也不写入 Session event。

## 相关文档

- [插件宿主包](../../Core/runtime-diagnostics/plugin-host/README.zh.md)——包配置和 adapter 用法。
- [能力接缝](../capability-seams.zh.md)——Definition、Provider、Consumer、policy 和 projection 角色。
- [架构](../architecture.zh.md#cordis)——Cordis runtime 和 profile 组合。
