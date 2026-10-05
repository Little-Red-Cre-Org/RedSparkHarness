---
description: "持久化 Session 模型选择，并让后续请求使用准确选定的 Provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-model-selection

[English](README.md) | 中文

## 摘要

为一个 Session 保存模型选择，并在冷恢复后重建。并发选择比较最新持久意图的 revision；过期选择失败，不替换已接受的选择。选定的 Program 在派发前记录模型变更提示与请求参数。

## 目录

- [配置](#configuration)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待完成工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

<a id="configuration"></a>

## 配置

原生入口要求 `activeSessions`、`agents` 与 `modelDirectory`，提供 `modelSelection`。它不接受配置。消费者传入显式请求默认值与准确的活跃 root owner；委派调用保留其 Program 所拥有的配置。

<a id="understand-the-implementation"></a>

## 理解实现

准确的 Provider 解析验证拟选模型。唯一 Program writer 比较观察到的意图 revision，追加 `model/selection`，并在确认前 flush。解析可以并发进行；每个 owner 串行比较与持久化。调用方、Agent 与 Provider 取消会阻止准入，移除会排空已接纳操作。浏览器安全的 `./types` 投影包含继承的 fork 历史，不打开存储。

选择捕获将请求参数与建议默认值分开。[模型执行器](../../core/native-model-execution/README.zh.md) 一起捕获实际元数据与派发；[Headless 消费者](../../core/native-headless/README.zh.md) 在请求响应前记录这些 prepared 参数。旧 header 的有效默认值不会变成人类选择。此服务不拥有另一个 writer 或全局默认值。[决策](../../../../.agents/notes/implemented/architecture/2026-10-05-native-model-selection-and-prepared-dispatch.zh.md)。

<a id="model-experience"></a>

## 模型体验

### Session 模型意图

#### 模型看到的内容

选择事实不进入模型历史。Provider 或模型变化会添加已持久化提示，说明前后路由；仅 effort 变化时记录变化后的请求 header，不添加路由提示。

#### Token 影响

目录读取不消耗模型 token。路由提示会为后续请求增加一条短消息。

#### KV Cache 影响

切换模型可能改变缓存可用性。此包不承诺跨模型保留缓存。

#### 理解实现

[持久选择投影](../../core/native-model-execution/src/model-selection.ts) 与 [选择准入](src/service.ts) 共用完整 Session 历史；Headless 使用 prepared dispatch 记录参数与路由提示。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与待完成工作

- 目录仅供参考；准确解析决定可用性。SDK、ACP 与 Web 选择界面是独立消费者。此包不提供交互登录、设置编辑器或全局默认值。

<a id="dev-note"></a>

### 开发笔记

不发布 invariant 配套入口：选择记录使用准确的 Program writer，没有独立的持久观察。Host 与 Client 编译面保持分离。
