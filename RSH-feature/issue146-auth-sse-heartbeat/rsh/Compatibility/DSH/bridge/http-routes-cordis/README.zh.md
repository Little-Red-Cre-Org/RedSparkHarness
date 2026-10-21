---
description: "为所选 HTTP WebServer Provider 提供 Cordis Context 与 event 声明。"
kind: "package-library"
---

# @deepseek-ai/dsh-http-routes-cordis

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-http-routes-cordis` 承载 `ctx.webServer` 与 `webserver/index-inject` 的 Cordis 兼容约定。读取 WebServer service 或其注入事件的 Cordis consumer 应导入它。该 bridge 在框架无关的 `@deepseek-ai/dsh-http-routes` 路由定义之上提供旧 Web 路由名称与 WebServer 配置类型；它不监听也不分发请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

当 Cordis 程序消费 WebServer service 或贡献结构化 index 输入时导入此 bridge。Native listener 代码直接从 Core 包导入路由约定，无需加载此兼容包。

### 入口

```text
import type {} from '@deepseek-ai/dsh-http-routes-cordis'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
const removeRoute = ctx.webServer.register(route)
await removeRoute()
```

route disposer 会停止后续接纳，并在该注册项已接纳的 handler 结算后返回。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis Context service 与 event augmentation，以及旧 WebServer 类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [HTTP routes 子系统](../../../../Docs/subsystems/http-routes.zh.md)——通用 route 与 listener 约定。
- [WebServer 包](../../../../Programs/Web/host/webserver/README.zh.md)——所选 Cordis HTTP listener。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：通过 `cordis_inspect_query` 的 Service catalog，本 bridge 会把 `ctx.webServer.register(HttpRoute)`、`registerUpgrade(HttpUpgradeRoute)` 和 `webserver/index-inject` 作为 Cordis 编码参考提供给模型。

#### KV Cache 影响

仅在查询时才把路由契约加入上下文；后续查询追加在当时对话末尾，未变化的前缀仍可复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

本包不会发布不变式配套包，因为它只扩展 Cordis TypeScript 声明，不拥有运行时安装器或不变式注册。

- 本包只描述 Cordis consumer；不提供 listener 或 Native 路由能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
