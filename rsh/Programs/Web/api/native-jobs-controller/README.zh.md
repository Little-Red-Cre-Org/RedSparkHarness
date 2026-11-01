---
description: "通过已认证的 RPC 与实时任务流，把 Native 后台任务元数据提供给浏览器。"
kind: "package-reference"
---

# Native jobs controller

[English](README.md) | 中文

## 摘要

Native Web 应用可以列出一个 Session 的后台任务，并跟随已提交的变更。任务行有意省略持有它的 Agent 对象，因为该对象无法跨越传输层。应用必须安装 Native 任务注册表与本控制器。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [开发说明](#dev-note)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="reference"></a>
## 参考

Native Web profile 在 Native 任务注册表之后安装本控制器。它需要 Host Connection、Native agent 注册表与 Native 任务注册表。

`session/jobs/list` 按拥有该任务的 Session 分组，返回每个任务一行。`/api/session/jobs/follow` 是一条已认证的 Fetch 路由，先发 SSE baseline，再发 upsert 与 remove 帧。每次轮询最多每秒重读一次注册表；等待发生在读取之前，中止会立刻结束该流。

`owner` 是有意丢弃的：浏览器以 `sessionId` 为键，而 Agent 对象无法跨越传输层。注册表报告的其余字段本来就是纯数据。

失败使用 `native/jobs` 与统一消息。客户端消费者是来自 [Native Session](../../client/native-session/README.zh.md) 的 `clientNativeSessionJobs`。

<a id="invariants"></a>
## 不变量

不发布运行时不变式伴随包，因为本控制器只读取注册表已提交的任务状态，不维护第二份副本。

<a id="dev-note"></a>
## 开发说明

Native 任务注册表拥有任务状态与取消能力。本包拥有已认证的浏览器投影。

<a id="model-experience"></a>
## 模型体验

### Native Host

#### 模型看到什么

本包不提供任何内容给模型：`session/jobs/list` 与 `/api/session/jobs/follow` 都是仅浏览器可见的 RPC，不增加面向模型的输入或工具。

#### Token 影响

此处不创建任何模型请求内容。

#### KV Cache 影响

此处不创建任何模型请求内容。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 任务注册表不发布变更通知，因此该流采用轮询加比对，而不是推送。浏览器契约不依赖这一点：将来若加入订阅，`follow` 的帧格式保持不变。
- 本控制器只读取任务，不取消它们。
