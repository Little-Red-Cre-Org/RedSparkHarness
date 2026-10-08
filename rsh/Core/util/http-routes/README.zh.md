---
description: "定义 Node HTTP 路由约定，以及供所选 Web listener 共用的单一可排空路由表。"
kind: "package-library"
---

# @deepseek-ai/dsh-http-routes

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-http-routes` 为所选 Node HTTP listener 提供一套路由约定与可排空的内存表。Cordis Web 和 Native Web listener Provider 共用它；功能 owner 注册路由并持有其 disposer。HTTP 匹配先查精确路径，再查最长匹配前缀；upgrade 使用另一张精确路径表。Host 与 Native 入口只包含 Node 路由类型；浏览器 index 输入由 Client 入口提供。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

当 Node HTTP listener 需要共用路由注册和 teardown 行为时使用此库。Cordis Web 与 Native Web carrier 消费 Host 约定；浏览器页面组装器从 `./client` 导入 index 注入值。

### 入口

```text
import { HttpRouteTable } from '@deepseek-ai/dsh-http-routes/native'

const routes = new HttpRouteTable()
const dispose = routes.register({ kind: 'exact', path: '/health', handler })
await dispose() // removes future admission and drains this route's handlers
await routes.close() // removes all routes and drains admitted handlers
```

重复的 `(kind, path)` 注册会抛错。HTTP 与 upgrade 路由保存在不同表中，因此同一路径可分别拥有一条 HTTP 路由和一条 upgrade 路由。

移除路由或关闭路由表时，会断开请求体尚未接收完成的已接纳 HTTP 请求，然后排空其 handler。请求体已接收完成的请求会按正常 handler 生命周期继续运行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/host.ts`](src/host.ts) | Node HTTP route、upgrade 与 listener 约定 |
| [`src/route-table.ts`](src/route-table.ts) | 精确优先的路由选择与已接纳 handler 排空 |
| [`src/native.ts`](src/native.ts) | 提供共享 table 与 listener 类型的无 Cordis Native 入口 |
| [`src/client.ts`](src/client.ts) | 浏览器安全的 index 注入数据与渲染 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [HTTP routes 子系统](../../../Docs/subsystems/http-routes.zh.md)——路由匹配、listener 所有权与 disposer 语义。
- [Cordis HTTP 兼容库](../../../Compatibility/DSH/bridge/http-routes-cordis/README.zh.md)——旧式 `ctx.webServer` 约定。
- [WebServer 包](../../../Programs/Web/host/webserver/README.zh.md)——Cordis listener Provider 与传输行为。

-----

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

本包不会发布不变式配套包，因为它公开可复用路由类型和可排空路由表，但不负责注册跨包不变式。

- 路由表位于内存中并属于单个 listener 生命周期；它不持久化路由，也不制定认证策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
