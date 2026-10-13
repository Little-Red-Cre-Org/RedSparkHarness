---
description: "共享 Native request-context 类型，并由消费它的 Program 持有请求接受与 Session 写入权。"
kind: "package-library"
---

# @deepseek-ai/dsh-request-context-definition

[English](README.md) | 中文

## 概述

本包声明 Native request-context 服务，以及应用和 Provider 共用的 request、provider、visibility 与 prepared-result 类型。Provider 准备分离的消息和候选状态；消费服务的 Program 负责准入、持久 Session 追加与冲刷，以及何时提交准备状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [继续探索](#further-exploration)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

### 何时使用

当 Native request-context Provider 与消费它的 Program 共用 `requestContexts` 时使用此 Definition。请求提供精确的活动 Session owner、最终已准入输入、一次 durable event 快照，以及由模型或 PTC 执行路线捕获的工具注册。

### 入口

从包根导入 `NativeRequestContextProvider`、`NativeRequestContextRequest`、`NativeRequestContextRegistration`、`PreparedNativeRequestContext` 和 `NativeRequestContexts`。`register()` 返回可调用的 `NativeRequestContextRegistration`；其 `isVisible(scope)` 会检查该精确注册是否仍为最近胜者。Provider 返回分离的消息与 `commit()` 操作，但不追加 Session。Program 同步检查最终准入，通过既有 writer 追加，并在 Provider 状态提交前完成 flush。

```ts
import type {
  NativeRequestContextProvider,
  NativeRequestContextRequest,
  NativeRequestContextRegistration,
  NativeRequestContexts,
  PreparedNativeRequestContext,
} from '@deepseek-ai/dsh-request-context-definition'
```

request、provider、visibility、prepared-result 和 service 声明逐字记录在 [request-context 子系统页](../../../Docs/subsystems/request-context.zh.md)。

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包通过 `NativeServices` 增加 `requestContexts` 服务，并导出品牌化 provider id。它不包含注册表运行时、Cordis 依赖或可安装的 Provider 入口。

</details>

<a id="further-exploration"></a>

## 继续探索

- [request-context 子系统](../../../Docs/subsystems/request-context.zh.md)
- [Native request-context Provider](../request-context/README.zh.md)
- [Native Headless](../../core/native-headless/README.zh.md)
- [架构](../../../Docs/architecture.zh.md#turn-flow)

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与待办

- 本包只声明类型；Native Provider 与消费应用必须提供服务和请求生命周期。
- 它不定义 Session 事件类型，也不授予 Provider Session 写入权。
- 本包没有可观察的运行时状态，因此不发布 invariant 配套包。

<a id="dev-note"></a>

### 开发备注

无。
