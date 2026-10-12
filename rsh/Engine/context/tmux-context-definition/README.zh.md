---
description: "在 Native 应用与 Provider 之间共用 tmux 上下文服务类型，同时由应用持有 Session 写入权。"
kind: "package-library"
---

# @deepseek-ai/dsh-tmux-context-definition

[English](README.md) | 中文

## 概述

Native 应用与 Provider 使用本包共享 `tmuxContext` 请求和服务类型。Provider 根据已提交的 Session 事件准备可选消息；应用继续使用自己的 Session writer，并在模型派发前追加消息。

## 目录

- [使用本包](#use-this-package)
- [实现](#implementation)
- [继续探索](#further-exploration)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

### 何时使用

当 Native 应用或 Provider 共用 `tmuxContext` 服务时使用 Definition。应用负责持久化 Session 追加；本包只声明请求与服务类型。

### 入口

从包根导入请求与服务类型。服务接收确切的 Session、活动中的 turn 与 step，以及取消信号；`seed()` 和 `record()` 遵循应用加载与提交事件的顺序。

```ts
import type { NativeTmuxContext, NativeTmuxContextRequest } from '@deepseek-ai/dsh-tmux-context-definition'
```

本包导出的 [`NativeTmuxContextRequest` 和 `NativeTmuxContext`](../../../Docs/subsystems/tmux-context.zh.md) 已在子系统页逐字记录源声明与 JSDoc。

<a id="implementation"></a>

## 实现

入口声明 Native 服务并扩展 `NativeServices`；它不导入 Cordis，也不激活 Provider。Official Provider 与 Native Headless 共用这些类型，Headless 仍是模型可见 Session 消息的唯一写入者。

<a id="further-exploration"></a>

## 继续探索

- [tmux-context 子系统](../../../Docs/subsystems/tmux-context.zh.md)
- [Native tmux-context Provider](../../../Modules/Official/terminal/native-tmux-context/README.zh.md)
- [Native Headless](../../core/native-headless/README.zh.md)

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与待办

- 本包只声明类型；调用方必须安装 Provider 和消费该服务的应用。
- 本包不会发布 runtime invariant 配套包，因为它只声明服务类型，没有可独立观察的运行时状态。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
