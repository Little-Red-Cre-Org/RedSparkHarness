---
description: "用于 profile 所有工具决策的原生一次性审批策略与应答者注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-approval

[English](README.md) | 中文

## 概述

`dsh-native-approval` 提供原生 `approval` 服务。其 `ask` 策略按注册顺序询问应答者，`never` 则不询问任何应答者而拒绝。未得到回答或应答者失败的请求为 unavailable，取消为 cancelled，只有 `allowed-once` 会允许所请求的操作。该服务只接受精确登记的原生 Agent，因此过期或被替换的标识不能决定工具操作。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口要求 `agents`、提供 `approval`，并接受可选的 `policy`：`ask`（默认）或 `never`；未知字段会使激活失败。`registerAnswerer()` 会登记有序回调。返回 `undefined` 会交给下一回调；返回 outcome 会决定请求。回调拒绝会把请求解析为 `unavailable`，释放会在 Provider 交还应答者前取消全部未完成决定。

服务会返回 id、策略与封闭 outcome，但不写入 Session。消费应用会记录一条 `native-approval/asked` 事件及其匹配的 `native-approval/decided` 事件，然后记录关联的工具结果。原生 headless 为固定写入和受保护的原生工具贡献提供该应用路径。

<a id="model-experience"></a>
## 模型体验

只有消费原生应用把审批审计写入 Session，并把结果工具 outcome 渲染进去时，才会间接影响模型。

#### KV Cache 影响

消费应用拥有审批决定后的保留错误或普通工具结果。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Provider 没有内置终端应答者、浏览器投影或外部协议传输。
- 决定是一次性的；没有已记住的授权、规则存储或撤销记录。
- Provider 不拥有 Session 持久化、工具 schema 或工具结果渲染。

不发布 invariant companion，因为在应用写入审计对之前，策略决定没有独立的持久化观测。

<a id="dev-note"></a>
### 开发备注

无。
