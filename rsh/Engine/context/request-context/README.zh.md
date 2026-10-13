---
description: "提供按作用域管理的 Native request-context Provider，由所属 Program 接受消息和状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-request-context

[English](README.md) | 中文

## 概述

Native request-context Provider 提供按作用域管理的持久模型请求上下文注册表。它会准备所有可见 Provider，再将分离的消息交给消费它的 Program 所拥有的唯一 Session 接受路径。只有 Program 接受并 flush 请求后，Provider 状态才会提交。

## 目录

- [使用本包](#use-this-package)
- [实现](#understand-the-implementation)
- [继续探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

当应用与 Provider 包需要为模型请求注册持久上下文时，在 Native profile 安装此 Provider。

### 何时选择

当消费应用提供精确的活动 Session owner，并负责最终准入、Session 追加与 flush 时选择此 Provider。Root 与 delegated Program 共用同一 Headless 请求路径。没有可见 Provider 时，应用仍会运行正常的接受路径。

### 最小 Native profile 安装

将 Provider 加入 profile 的 installation 列表。它不接受配置：

```json
{
  "formatVersion": 1,
  "installations": [
    { "id": "request-context", "plugin": "@deepseek-ai/dsh-request-context", "scope": "root" }
  ]
}
```

Provider 提供 `requestContexts`；应用和其他 Provider 从 [`dsh-request-context-definition`](../request-context-definition/README.zh.md) 获取其声明。

<a id="understand-the-implementation"></a>

## 实现

可见 Provider 按 `order` 升序准备；相同时按 provider id 排序。每个 Provider 返回分离的消息和候选状态；注册表不会写入 Session。应用提供接受回调，负责同步执行最终检查、通过既有 writer 追加并 flush。只有返回 `accepted` 才会提交准备好的 Provider 状态；拒绝时不提交，准备、接受或 flush 失败都会拒绝该请求。

请求携带来自模型或 PTC 执行快照的精确可见性。`includes()` 按捕获时的 registration disposer identity 匹配，因此同名 schema 不会让被替换的注册重新可见。

<a id="further-exploration"></a>

## 继续探索

- [request-context 子系统](../../../Docs/subsystems/request-context.zh.md)
- [Cordis-free request-context Definition](../request-context-definition/README.zh.md)
- [Native Headless](../../core/native-headless/README.zh.md)
- [Native tools](../../core/native-tools/README.zh.md)
- [request-context 接受决策](../../../../.agents/notes/implemented/architecture/2026-10-13-native-request-context-acceptance.zh.md)

<a id="model-experience"></a>

## 模型体验

由消费它的 Program 间接影响：已接受的 Provider 消息会在派生模型请求前追加并 flush 到 Session，因此属于可重建的模型历史。

#### KV Cache effect

已接受消息会在模型派发前扩展请求前缀。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与待办

- Provider 只提供注册表；它不会安装 request-context 贡献者或负责请求接受的应用。
- 如果消费 Program 未提供精确活动 Session owner 和持久接受回调，服务无法工作。
- Provider 无法独立观察消费 Program 是否 flush 了 owner 的 Session，因此不发布 invariant 配套包。

<a id="dev-note"></a>

### 开发备注

无。
