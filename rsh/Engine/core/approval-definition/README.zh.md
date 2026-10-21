---
description: "在 Provider 与 Consumer 间共享原生审批契约和 Cordis-free 旧版审计类型。"
kind: "package-library"
---

# @deepseek-ai/dsh-approval-definition

[English](README.md) | 中文

## 概述

本包让原生和 Compatibility 消费者共享审批标识、结果及服务操作。原生调用方使用根入口；Cordis 调用方使用 `/legacy` 并传入真实 owner 类型，例如 `Agent`。本包定义契约和 Session 策略辅助函数，但不分派应答者，也不拥有应用的 Session。

## 目录

- [使用本包](#use-this-package)
- [实现方式](#implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

### 适用场景

原生审批 Provider 和应用从根入口导入服务契约。`compat-user-approval` 与 `dsh-tools` 导入 `/legacy`；它们面向 Cordis 的类型将 `ApprovalServiceDefinition<Agent>` 专门化，因此实现仍能访问存活 Agent、其 Session 及其作用域注入能力。

### 入口

根入口和 legacy 入口分别保留 `native-approval/*` 记录与兼容 `approval/*` 记录。调用方必须使用所选 Provider 对应的契约；本包不会把一种历史转换成另一种。

```ts
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition/legacy'

type CordisApproval = ApprovalServiceDefinition<Agent>
```

兼容桥接使用原始存活 Agent 对象实现这个专门化类型。

<a id="implementation"></a>

## 实现方式

根入口声明原生请求和应答者操作。`/legacy` 入口声明兼容请求与结果类型、通用 Agent owner 参数，以及在同一个 Cordis-free Session 对象上读取或追加策略事件的辅助函数。Cordis 分派与模型上下文更新由 `compat-user-approval` 负责；原生 Session 写入与工具结果投影由所选原生应用负责。

两个入口都通过 `dsh-session/native` 和 `dsh-session/types` 导入 Session 声明，不经由带 Cordis 的 SessionStore 根入口。本包不发布 `./invariant` companion，因为它的品牌类型和策略辅助函数没有独立注册表或状态；兼容审计事件对的校验仍由其 Provider 负责。

<a id="further-exploration"></a>

## 延伸阅读

- [审批子系统](../../../Docs/subsystems/approval.zh.md)
- [原生审批 Provider](../../../Modules/Official/interaction/native-approval/README.zh.md)
- [Cordis 审批桥接](../../../Compatibility/DSH/bridge/compat-user-approval/README.zh.md)
- [审批所有权决策](../../../../.agents/notes/implemented/architecture/2026-09-23-native-tool-approval.zh.md)

<a id="model-experience"></a>

本包不发布运行时 invariant companion，因为本包不保存独立审批状态；所选 Provider 负责审计事件对校验，Session 负责持久事件顺序。

## 模型体验

无，因为审批契约和策略辅助函数不会构造模型请求。

#### KV Cache effect

本包不会新增或重排模型请求内容。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 本包不实现应答者分派、UI 呈现或应用 Session 所有权；应选择对应的原生或 Compatibility Provider。

<a id="dev-note"></a>

### 开发备注

原生与 legacy 审批契约有意保留不同的事件名和投影规则。
